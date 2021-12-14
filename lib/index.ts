import * as path from "path";
import { consoleHack, consoleRestore } from "./core/runtime/console.hack";
import {
  httpCreateServerHack,
  httpsCreateServerHack,
  httpCreateServerRestore,
  httpsCreateServerRestore
} from "./core/runtime/create-server.hack";
import { dnsHack, dnsRestore } from "./core/runtime/dns.hack";
import { requestHack, requestRestore } from "./core/runtime/capture/index";
import { winstonHack, winstonRestore } from "./core/winston";
import { eventBus } from "./core/bus";
import logger from "./core/logger";
import initPrivateData from "./core/util/privateLog";

export const installHacks = (): void => {
  httpCreateServerHack();
  httpsCreateServerHack();
  dnsHack();
  consoleHack();
  requestHack();
  winstonHack();
};

export const uninstallHacks = (): void => {
  httpCreateServerRestore();
  httpsCreateServerRestore();
  dnsRestore();
  consoleRestore();
  requestRestore();
  winstonRestore();
};

export default async (
  basePath: string,
  mainPath: string,
  configPath: string
): Promise<any> => {
  const configAbsolutePath = path.resolve(basePath, configPath);
  global.tswConfig = await import(configAbsolutePath);
  const privateLog = initPrivateData();
  logger.setCleanLog(global.tswConfig.cleanLog);
  logger.setLogLevel(global.tswConfig.logLevel);
  logger.setDsableLog(global.tswConfig.disableLog);
  logger.setDsableConsole(global.tswConfig.disableConsole);
  logger.setPrivateLog(privateLog);

  if (global.tswConfig.plugins) {
    // eslint-disable-next-line no-restricted-syntax
    for (const plugin of global.tswConfig.plugins) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await plugin.init(eventBus, global.tswConfig);
      } catch (e) {
        console.error(`${plugin.name} 插件初始化失败: ${e.message}`);
        process.exit(-1);
      }
    }
  }

  installHacks();
  if (basePath && mainPath) {
    await import(path.resolve(basePath, mainPath));
  }

  return logger;
};
