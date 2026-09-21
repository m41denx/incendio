export enum BYTES_UNITS {
  B = "B",
  KB = "kB",
  MB = "MB",
  GB = "GB",
  TB = "TB",
  PB = "PB",
  EB = "EB",
  KIB = "KiB",
  MIB = "MiB",
  GIB = "GiB",
  TIB = "TiB",
  PIB = "PiB",
  EIB = "EiB",
}

export enum MEM_LIMIT_TYPE {
  FIXED = 0,
  PERCENT = 1,
}

export interface MemoryLimit {
  value?: number;
  unit: BYTES_UNITS | "%";
  selectedType: MEM_LIMIT_TYPE;
}

export enum CPU_LIMIT_TYPE {
  DYNAMIC = 0,
  FIXED = 1,
  TOPOLOGY = 2,
}

export interface CpuLimit {
  dynamicValue?: number | string;
  fixedValue?: string;
  // VM-only explicit topology: limits.cpu=sockets=2,cores=4,threads=2
  sockets?: number | string;
  cores?: number | string;
  threads?: number | string;
  selectedType: CPU_LIMIT_TYPE;
}
