/* !
 * Tencent is pleased to support the open source community by making Tencent Server Web available.
 * Copyright (C) 2018 THL A29 Limited, a Tencent company. All rights reserved.
 * Licensed under the MIT License (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at
 * http://opensource.org/licenses/MIT
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import * as http from "http";
import * as https from "https";
import * as domain from "domain";
import { URL } from "url";
import { Socket, isIP } from "net";
import { cloneDeep } from "lodash";
import { captureOutgoing } from "./outgoing";
import { captureIncoming } from "./incoming";

import currentContext, { RequestLog, Context } from "../../context";
import logger from "../../logger/index";

type requestProtocol = "http:" | "https:";

/**
 * Convert a URL instance to a http.request options
 * https://github.com/nodejs/node/blob/afa9a7206c26a29a2af226696c145c924a6d3754/lib/internal/url.js#L1270
 * @param url a URL instance
 */
const urlToOptions = (url: URL): http.RequestOptions => {
  const options: http.RequestOptions = {
    protocol: url.protocol,
    hostname: typeof url.hostname === "string" && url.hostname.startsWith("[")
      ? url.hostname.slice(1, -1)
      : url.hostname,
    path: `${url.pathname || ""}${url.search || ""}`
  };

  if (url.port !== "") {
    options.port = Number(url.port);
  }

  if (url.username || url.password) {
    options.auth = `${url.username}:${url.password}`;
  }

  return options;
};

export const hack = <T extends typeof http.request>(
  originRequest: T,
  protocol: requestProtocol
): ((...args: unknown[]) => http.ClientRequest) => (
    (...args): http.ClientRequest => {
      let options: http.RequestOptions;
      if (typeof args[1] === "undefined" || typeof args[1] === "function") {
        // function request(options: RequestOptions | string | URL, callback?: (res: IncomingMessage) => void): ClientRequest;
        if (typeof args[0] === "string") {
          options = urlToOptions(new URL(args[0]));
        } else if (args[0] instanceof URL) {
          options = urlToOptions(args[0]);
        } else {
          options = args[0] as http.RequestOptions;
        }
      } else {
        // function request(url: string | URL, options: RequestOptions, callback?: (res: IncomingMessage) => void): ClientRequest;
        if (typeof args[0] === "string") {
          options = urlToOptions(new URL(args[0]));
        } else {
          options = urlToOptions(args[0] as URL);
        }

        options = Object.assign(options, args[1]);
      }

      // Execute request
      const request: http.ClientRequest = originRequest.apply(this, args);
      // Execute capture，ClientRequest extends OutgoingMessage(extends Stream.Writable)
      captureOutgoing(request);

      const context = currentContext() || new Context();

      const {
        method, hostname, path, port, headers
      } = options;

      const logPre = {
        http_sn: context.captureSN,
        method,
        hostname,
        port: port || "NULL",
        protocol: protocol === "http:" ? "HTTP" : "HTTPS",
        request_header: Object.prototype.toString.call(headers) === "[object Object]" ? JSON.stringify(headers) : headers,
        request_url: path.split("?")[0],
        path
      };

      logger.info({
        ...logPre,
        log_type: "http",
        sub_log_type: "http_request_begin"
      });

      const requestLog: Partial<RequestLog> = {
        SN: context.captureSN,

        protocol: protocol === "http:" ? "HTTP" : "HTTPS",
        host: hostname,
        path,

        process: `TSW: ${process.pid}`,
        timestamps: {} as RequestLog["timestamps"]
      };

      const { timestamps } = requestLog;
      timestamps.requestStart = new Date();

      const clearDomain = (): void => {
        const parser = (request.socket as any)?.parser as any;
        if (parser && parser.domain) {
          (parser.domain as domain.Domain).exit();
          parser.domain = null;
        }
      };

      const finishRequest = (): void => {
        context.captureRequests.push(requestLog as RequestLog);
        logger.info({
          ...logPre, log_type: "http", sub_log_type: "record_request", size: requestLog.responseLength
        });
      };

      request.once("socket", (socket: Socket): void => {
        timestamps.onSocket = new Date();

        if (!isIP(hostname)) {
          socket.once("lookup", (
            err: Error,
            address: string,
            family: string | number,
            host: string
          ): void => {
            timestamps.onLookUp = new Date();
            timestamps.dnsTime = timestamps.onLookUp.getTime()
              - timestamps.onSocket.getTime();

            logger.info({
              ...logPre, log_type: "http", sub_log_type: "dns_lookup_done", hostname: host, address: address || "null", cost: timestamps.dnsTime
            });

            if (err) {
              if (logger.getCleanLog()) {
                logger.error({
                  ...logPre, log_type: "http", sub_log_type: "dns_lookup_error", hostname: host, address: address || "null", message: JSON.stringify(requestLog).replace(/[\r\n]/g, "")
                });
              }

              logger.error({
                ...logPre, log_type: "http", sub_log_type: "dns_lookup_error", hostname: host, address: address || "null", message: err.message.replace(/[\r\n]/g, ""), stack: err.stack.replace(/[\r\n]/g, "")
              });
            }
          });
        }

        socket.once("connect", (): void => {
          timestamps.socketConnect = new Date();
          logger.info({
            ...logPre, log_type: "http", sub_log_type: "socket_connected", remote: `${socket.remoteAddress}:${socket.remotePort}`, cost: timestamps.socketConnect.getTime() - timestamps.onSocket.getTime()
          });
        });

        if (socket.remoteAddress) {
          timestamps.dnsTime = 0;
          logger.info({
            ...logPre, log_type: "http", sub_log_type: "socket_reused", remote: `${socket.remoteAddress}:${socket.remotePort}`
          });
        }
      });

      request.once("error", (error: Error) => {
        if (logger.getCleanLog()) {
          logger.error({
            ...logPre,
            log_type: "http",
            sub_log_type: "request_error",
            message: JSON.stringify(requestLog).replace(/[\r\n]/g, "")
          });
        }

        logger.error({
          ...logPre,
          log_type: "http",
          sub_log_type: "request_error",
          message: error.message.replace(/[\r\n]/g, ""),
          stack: error.stack.replace(/[\r\n]/g, "")
        });

        finishRequest();
        clearDomain();
      });

      request.once("close", clearDomain);

      request.once("finish", () => {
        timestamps.requestFinish = new Date();

        context.captureSN += 1;

        let requestBody: string;
        const length = (request as any)._bodyLength;
        const tooLarge = (request as any)._bodyTooLarge;
        if (tooLarge) {
          requestBody = Buffer.from(`body was too large too show, length: ${
            length}`).toString("base64");
        } else {
          requestBody = (request as any)._body.toString("base64");
        }

        requestLog.requestHeader = (request as any)._header;
        requestLog.requestBody = requestBody;
        logger.info({
          ...logPre,
          log_type: "http",
          sub_log_type: "request_send_finish",
          size: length,
          header: requestLog.requestHeader,
          cost: timestamps.requestFinish.getTime() - timestamps.onSocket.getTime()
        });

        clearDomain();
      });

      request.once("response", (response: http.IncomingMessage): void => {
        timestamps.onResponse = new Date();

        const { socket } = response;
        requestLog.serverIp = socket.remoteAddress;
        requestLog.serverPort = socket.remotePort;
        // This could be undefined
        // https://stackoverflow.com/questions/16745745/nodejs-tcp-socket-does-not-show-client-hostname-information
        requestLog.clientIp = socket.localAddress;
        requestLog.clientPort = socket.localPort;

        logger.info({
          ...logPre,
          log_type: "http",
          sub_log_type: "response_start",
          chain: `${socket.localAddress}:${socket.localPort}`,
          remote: `${socket.remoteAddress}:${socket.remotePort}`,
          cost: timestamps.onResponse.getTime() - timestamps.onSocket.getTime()
        });

        // responseInfo can't retrieve data until response "end" event
        const responseInfo = captureIncoming(response);

        response.once("end", () => {
          timestamps.responseClose = new Date();

          requestLog.statusCode = response.statusCode;
          requestLog.responseLength = responseInfo.bodyLength;
          requestLog.responseType = response.headers["content-type"];
          requestLog.responseHeader = ((): string => {
            const result = [];
            result.push(`HTTP/${response.httpVersion} ${
              response.statusCode} ${response.statusMessage}`);

            const cloneHeaders = cloneDeep(response.headers);
            // Transfer a chunked response to a full response.
            // https://imququ.com/post/transfer-encoding-header-in-http.html
            if (!cloneHeaders["content-length"]
            && responseInfo.bodyLength >= 0) {
              delete cloneHeaders["transfer-encoding"];
              cloneHeaders["content-length"] = String(responseInfo.bodyLength);
            }

            Object.keys(cloneHeaders).forEach((key) => {
              result.push(`${key}: ${cloneHeaders[key]}`);
            });

            result.push("");
            result.push("");

            return result.join("\r\n");
          })();

          requestLog.responseBody = responseInfo.body.toString("base64");

          logger.info({
            ...logPre,
            log_type: "http",
            sub_log_type: "response_end",
            chain: `${socket.localAddress}:${socket.localPort}`,
            remote: `${socket.remoteAddress}:${socket.remotePort}`,
            size: requestLog.responseLength,
            cost: timestamps.responseClose.getTime() - timestamps.onSocket.getTime()
          });

          finishRequest();
        });
      });

      return request;
    }
  );

let hacked = false;
let originHttpRequest = null;
let originHttpsRequest = null;
export const requestHack = (): void => {
  if (!hacked) {
    originHttpRequest = http.request;
    originHttpsRequest = https.request;
    // @ts-ignore
    // By default, ts not allow us to rewrite original methods.
    http.request = hack(http.request, "http:");
    // @ts-ignore
    // By default, ts not allow us to rewrite original methods.
    https.request = hack(https.request, "https:");

    hacked = true;
  }
};

export const requestRestore = (): void => {
  if (hacked) {
    // eslint-disable-next-line
    // @ts-ignore
    // By default, ts not allow us to rewrite original methods.
    http.request = originHttpRequest;
    // eslint-disable-next-line
    // @ts-ignore
    // By default, ts not allow us to rewrite original methods.
    https.request = originHttpsRequest;

    hacked = false;
  }
};
