import {
  BYTES_UNITS,
  CPU_LIMIT_TYPE,
  MEM_LIMIT_TYPE,
  type CpuLimit,
  type MemoryLimit,
} from "types/limits";

export const parseCpuLimit = (limit?: string): CpuLimit | undefined => {
  if (!limit) {
    return undefined;
  }

  // VM topology, e.g. "sockets=2,cores=4,threads=2". Check before the comma
  // branch, since a topology string also contains commas.
  if (limit.includes("=")) {
    const parts: Record<string, string> = {};
    for (const segment of limit.split(",")) {
      const [rawKey, rawValue] = segment.split("=");
      if (rawKey && rawValue !== undefined) {
        parts[rawKey.trim()] = rawValue.trim();
      }
    }
    return {
      sockets: parts.sockets,
      cores: parts.cores,
      threads: parts.threads,
      selectedType: CPU_LIMIT_TYPE.TOPOLOGY,
    };
  }

  if (limit.includes(",") || limit.includes("-")) {
    return {
      fixedValue: limit,
      selectedType: CPU_LIMIT_TYPE.FIXED,
    };
  }

  return {
    dynamicValue: parseInt(limit),
    selectedType: CPU_LIMIT_TYPE.DYNAMIC,
  };
};

export const parseMemoryLimit = (limit?: string): MemoryLimit | undefined => {
  if (!limit) {
    return undefined;
  }
  if (limit.includes("%")) {
    return {
      value: parseInt(limit),
      unit: "%",
      selectedType: MEM_LIMIT_TYPE.PERCENT,
    };
  }
  return {
    value: parseInt(limit),
    unit: limit.replace(/[0-9]/g, "") as BYTES_UNITS,
    selectedType: MEM_LIMIT_TYPE.FIXED,
  };
};

const getUnitExponent = (unit: BYTES_UNITS): number => {
  switch (unit) {
    case BYTES_UNITS.B:
      return 1;
    case BYTES_UNITS.KB:
      return 10 ** 3;
    case BYTES_UNITS.MB:
      return 10 ** 6;
    case BYTES_UNITS.GB:
      return 10 ** 9;
    case BYTES_UNITS.TB:
      return 10 ** 12;
    case BYTES_UNITS.PB:
      return 10 ** 15;
    case BYTES_UNITS.EB:
      return 10 ** 18;
    case BYTES_UNITS.KIB:
      return 2 ** 10;
    case BYTES_UNITS.MIB:
      return (2 ** 10) ** 2;
    case BYTES_UNITS.GIB:
      return (2 ** 10) ** 3;
    case BYTES_UNITS.TIB:
      return (2 ** 10) ** 4;
    case BYTES_UNITS.PIB:
      return (2 ** 10) ** 5;
    case BYTES_UNITS.EIB:
      return (2 ** 10) ** 6;
  }
};

export const limitToBytes = (limit?: string): number => {
  const value = parseMemoryLimit(limit);
  if (value?.value && value.unit !== "%") {
    return value.value * getUnitExponent(value.unit);
  } else {
    return 0;
  }
};

export const formatBytes = (bytes: number, unit: BYTES_UNITS): number => {
  return bytes / getUnitExponent(unit);
};
