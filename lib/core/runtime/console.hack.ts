/* !
 * Tencent is pleased to support the open source community by making Tencent Server Web available.
 * Copyright (C) 2018 THL A29 Limited, a Tencent company. All rights reserved.
 * Licensed under the MIT License (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at
 * http://opensource.org/licenses/MIT
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import * as util from "util";

import logger from "../logger/index";
import getCurrentContext from "../context";

let consoleHacked = false;

export const consoleHack = (): void => {
  if (!consoleHacked) {
    consoleHacked = true;

    console.originDebug = console.debug;
    console.originLog = console.log;
    console.originInfo = console.info;
    console.originDir = console.dir;
    console.originWarn = console.warn;
    console.originError = console.error;

    console.debug = (
      message?: any,
      ...optionalParams: any[]
    ): void => {
      if (getCurrentContext() === null) {
        return console.originDebug(message, ...optionalParams);
      }

      return logger.writeLog(
        "DEBUG",
        // `${util.format(message, ...optionalParams)}`
        message
      );
    };

    console.log = (
      message?: any,
      ...optionalParams: any[]
    ): void => {
      if (getCurrentContext() === null) {
        return console.originLog(message, ...optionalParams);
      }

      return logger.writeLog(
        "DEBUG",
        // `${util.format(message, ...optionalParams)}`
        message
      );
    };

    console.info = (
      message?: any,
      ...optionalParams: any[]
    ): void => {
      if (getCurrentContext() === null) {
        return console.originInfo(message, ...optionalParams);
      }

      return logger.writeLog(
        "INFO",
        // `${util.format(message, ...optionalParams)}`
        message
      );
    };

    console.dir = (
      obj: any,
      options?: NodeJS.InspectOptions
    ): void => {
      if (getCurrentContext() === null) {
        return console.originDir(obj, options);
      }

      return logger.writeLog(
        "INFO",
        `${util.inspect(obj, {
          customInspect: false,
          ...options
        })}`
      );
    };

    console.warn = (
      message?: any,
      ...optionalParams: any[]
    ): void => {
      if (getCurrentContext() === null) {
        return console.originWarn(message, ...optionalParams);
      }

      return logger.writeLog(
        "WARN",
        // `${util.format(message, ...optionalParams)}`
        message
      );
    };

    console.error = (
      message?: any,
      ...optionalParams: any[]
    ): void => {
      if (getCurrentContext() === null) {
        return console.originError(message, ...optionalParams);
      }

      return logger.writeLog(
        "ERROR",
        // `${util.format(message, ...optionalParams)}`
        message
      );
    };

    // hack process._stdout
    // (process.stdout as any).originWrite = process.stdout.write;
    // process.stdout.write = (
    //   data: Buffer | string,
    //   encodingOrCallback?: string | ((err?: Error) => void) | undefined
    // ): boolean => {
    //   let encoding: BufferEncoding;
    //   if (typeof encodingOrCallback !== "function") {
    //     encoding = encodingOrCallback as BufferEncoding;
    //   }

    //   logger.writeLog(
    //     "DEBUG",
    //     data.toString(encoding).replace(/\n$/, "") // 去掉换行符
    //   );

    //   return true;
    // };

    // // hack process._stderr
    // (process.stderr as any).originWrite = process.stderr.write;
    // process.stderr.write = (
    //   data: Buffer | string,
    //   encodingOrCallback?: string | ((err?: Error) => void) | undefined
    // ): boolean => {
    //   let encoding: BufferEncoding;
    //   if (typeof encodingOrCallback !== "function") {
    //     encoding = encodingOrCallback as BufferEncoding;
    //   }

    //   logger.writeLog(
    //     "ERROR",
    //     data.toString(encoding).replace(/\n$/, "") // 去掉换行符
    //   );

    //   return true;
    // };
  }
};

export const consoleRestore = (): void => {
  if (consoleHacked) {
    consoleHacked = false;

    console.debug = console.originDebug;
    console.info = console.originInfo;
    console.log = console.originLog;
    console.warn = console.originWarn;
    console.error = console.originError;
    console.dir = console.originDir;

    process.stdout.write = (process.stdout as any).originWrite;
    process.stderr.write = (process.stderr as any).originWrite;

    delete console.originDebug;
    delete console.originInfo;
    delete console.originLog;
    delete console.originWarn;
    delete console.originError;
    delete console.originDir;

    delete (process.stdout as any).originWrite;
    delete (process.stderr as any).originWrite;
  }
};
