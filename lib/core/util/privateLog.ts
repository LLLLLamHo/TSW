export function initPrivateData(): {[propString: string]: any} {
  return {
    version: global.tswConfig.commonLogData && global.tswConfig.commonLogData.version ? global.tswConfig.commonLogData.version : "NULL",
    node_version: process.version || "NULL",
    pid: process.pid,
    ppid: process.ppid || "NULL"
  };
}

export default initPrivateData;
