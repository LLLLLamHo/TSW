/* !
 * Tencent is pleased to support the open source community by making Tencent Server Web available.
 * Copyright (C) 2018 THL A29 Limited, a Tencent company. All rights reserved.
 * Licensed under the MIT License (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at
 * http://opensource.org/licenses/MIT
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import * as moment from "moment";
import * as chalk from "chalk";
import * as path from "path";

import currentContext, { Log } from "../context";
import isLinux from "../util/isLinux";
import isInspect from "../util/isInspect";
import getCallInfo from "./callInfo";
import { Stream } from "stream";
import { config as winstonConfig, Logger as WinstonLogger } from "winston";

enum LOG_LEVEL {
  "DEBUG" = 10,
  "INFO" = 20,
  "WARN" = 30,
  "ERROR"= 40,
}

enum LOG_COLOR {
  "DEBUG" = "yellow",
  "INFO" = "blue",
  "WARN" = "magenta",
  "ERROR"= "red",
}

type LogLevelStrings = keyof typeof LOG_LEVEL;

type WinstonLogLevel = keyof typeof winstonConfig.syslog.levels;

export class Logger {
  private isCleanLog = false;

  public logLevel: number

  public dsableLog = false
  public dsableConsole = false

  public winstonLogger: WinstonLogger

  public privateLog: {[propsName: string]: any}

  public setPrivateLog(data: {[propsName: string]: any}): {[propsName: string]: any} {
    this.privateLog = data;
    return this.privateLog;
  }

  public setDsableConsole(dsableConsole: boolean): boolean {
    this.dsableConsole = dsableConsole;
    return this.dsableConsole;
  }

  public setDsableLog(dsableLog: boolean): boolean {
    this.dsableLog = dsableLog;
    return this.dsableLog;
  }

  public setLogLevel(level: LogLevelStrings = "DEBUG"): number {
    this.logLevel = LOG_LEVEL[level];
    return this.logLevel;
  }

  public setCleanLog(isCleanLog = false): void {
    this.isCleanLog = isCleanLog;
  }

  public getCleanLog(): boolean {
    return this.isCleanLog;
  }

  public debug(str: string|object): void {
    if (this.isCleanLog) return;

    if (!currentContext()) {
      console.log(Logger.formatStr(str, "DEBUG", {
        levelLimit: this.logLevel
      }));
    } else {
      this.writeLog("DEBUG", str);
    }
  }

  public info(str: string|object): void {
    if (this.isCleanLog) return;

    if (!currentContext()) {
      console.info(Logger.formatStr(str, "INFO", {
        levelLimit: this.logLevel
      }));
    } else {
      this.writeLog("INFO", str);
    }
  }

  public warn(str: string|object): void {
    if (!currentContext()) {
      console.warn(Logger.formatStr(str, "WARN", {
        levelLimit: this.logLevel
      }));
    } else {
      this.writeLog("WARN", str);
    }
  }

  public error(str: string|object): void {
    if (!currentContext()) {
      console.error(Logger.formatStr(str, "ERROR", {
        levelLimit: this.logLevel
      }));
    } else {
      this.writeLog("ERROR", str);
    }
  }

  public static clean(): void {
    let log = Logger.getLog();
    if (log) {
      log.arr = null;
      log = null;
    }
  }

  public writeLog(type: LogLevelStrings, str: string | object): void {
    const level = LOG_LEVEL[type];

    // Drop log
    if (level < this.logLevel) {
      return;
    }

    if (Object.prototype.toString.call(str) !== "[object Object]") {
      str = { log_type: type.toLocaleLowerCase(), message: str };
    }

    if (!str["log_type"]) {
      str["log_type"] = str["log_type"] || type.toLocaleLowerCase();
    }

    if (!str["sub_log_type"]) {
      str["sub_log_type"] = "console";
    }

    str = Object.assign(str, this.privateLog);

    const logStr = Logger.formatStr(str, type, {
      levelLimit: this.logLevel
    });

    // Store log
    Logger.fillBuffer(type, logStr);

    if (!this.dsableLog && this.winstonLogger) {
      const winstonLogType = Logger.getWinstonType(type);
      this.winstonLogger.log(`${winstonLogType}`, logStr);
    }

    if (isInspect()) {
      // When started with inspect, log will send to 2 places
      // 1. Local stdout
      // 2. Remote(maybe chrome inspect window) inspect window

      // Here for remote window
      Logger.fillInspect(logStr, level);

      const logWithColor = Logger.formatStr(str, type, {
        levelLimit: this.logLevel,
        color: true
      });

      // Here for local stdout, with color
      if (this.dsableConsole) return;
      Logger.fillStdout(logWithColor);
    } else {
      if (this.dsableConsole) return;
      // Send to local stdout
      Logger.fillStdout(logStr);
    }
  }

  /**
   * Convert TSW log level to winston log level
   * @param type Type of tsw log level
   */
  private static getWinstonType(type: LogLevelStrings): WinstonLogLevel {
    const logType = type.toLowerCase();
    const winstonLogLevel = winstonConfig.npm.levels; // winston内部使用的是npm levels
    if (winstonLogLevel[logType] != null) {
      return logType;
    }

    /**
     * Take the least important level from Winston syslog levels
     */
    const levels = Object.keys(winstonLogLevel);
    return levels[levels.length - 1];
  }

  /**
   * Format a string based on it's type(DEBUG/INFO/...)
   * @param str String need to be formatted
   * @param type Log level of this string
   * @param options Options
   * @param options.levelLimit Log level limit, log will be dropped when not match it
   * @param options.color Add ANSI color or not
   */
  private static formatStr(
    str: string | object,
    type: LogLevelStrings,
    options: {
      levelLimit: number;
      color?: boolean;
    }
  ): string {
    const { levelLimit, color } = options;

    let showLineNumber = false;
    let SN = -1;

    if (currentContext()) {
      ({ showLineNumber } = Logger.getLog());
      ({ SN } = currentContext());
    }

    const needCallInfoDetail = (LOG_LEVEL[type] >= levelLimit
      && showLineNumber)
      || !isLinux;

    const timestamp = moment(new Date()).format("YYYY-MM-DD HH:mm:ss.SSS");
    const logType = `[${type}]`;
    const pidInfo = `[${process.pid} ${SN}]`;
    const callInfo = ((): string => {
      if (!needCallInfoDetail) return "";
      // Magic number: 5
      // ./lib/core/logger/callInfo.js [exports.default]
      // ./lib/core/logger/index.js [THIS anonymous function]
      // ./lib/core/logger/index.js [formatStr]
      // ./lib/core/logger/index.js [writeLog]
      // ./lib/core/runtime/console.hack.js [console.log]
      // User called here
      const { column, line, filename } = getCallInfo(5);
      return `${filename.split(path.sep).join("/")}:${line}:${column}`;
    })();

    if (color) {
      const typeColor = LOG_COLOR[type];
      return `${chalk.whiteBright(timestamp)} ${chalk[typeColor](logType)} ${
        chalk.whiteBright(pidInfo)
      } ${chalk.blueBright(callInfo)} ${str}`;
    }

    return JSON.stringify({
      level: type.toLocaleLowerCase(),
      timestamp,
      sn: SN,
      call_info: callInfo,
      // @ts-ignore
      ...str
    }).replace(/[\r\n]/g, "");
  }

  private static getLog(): Log | undefined {
    if (!currentContext()) {
      return undefined;
    }

    const { log } = currentContext();
    return log;
  }

  private static fillBuffer(type: string, logStr: string): void {
    const log = Logger.getLog();
    if (log) {
      if (!log.arr) {
        log.arr = [];
      }

      if (logStr) {
        log.arr.push(logStr);
      }

      if (type) {
        if (log[type]) {
          log[type] += 1;
        } else {
          log[type] = 1;
        }
      }
    }
  }

  private static fillInspect(str: string, level: number): void {
    if ((console as any)._stdout === process.stdout) {
      const empty = new Stream.Writable();
      empty.write = (): boolean => false;
      empty.end = (): void => {};
      (console as any)._stdout = empty;
      (console as any)._stderr = empty;
    }
    /* eslint-enable */

    if (level <= 20) {
      (console.originLog || console.log)(str);
    } else if (level <= 30) {
      (console.originWarn || console.warn)(str);
    } else {
      (console.originError || console.error)(str);
    }
  }

  private static fillStdout(str: string): void {
    // console hacking origin write, so use originWrite
    const stdout = (process.stdout as any).originWrite || process.stdout.write;
    stdout.call(process.stdout, `${str}\n`);
  }
}

let logger: Logger;
if (!logger) {
  logger = new Logger();
}

export default logger;
