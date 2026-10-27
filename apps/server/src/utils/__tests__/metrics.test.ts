import { describe, expect, test } from 'bun:test';
import path from 'path';
import { DATA_PATH } from '../../helpers/paths';
import { getDiskMetrics } from '../metrics';

describe('getDiskMetrics', () => {
  test('should use only the filesystem containing DATA_PATH', async () => {
    const normalizedDataPath = path.resolve(DATA_PATH);
    const dataMount = path.dirname(normalizedDataPath);

    const mockedFsSize = [
      { mount: '/', size: 1_000, used: 300 },
      { mount: dataMount, size: 500, used: 120 },
      { mount: '/mnt/other', size: 10_000, used: 9_000 }
    ];

    const result = await getDiskMetrics({
      fsSize: async () => mockedFsSize,
      getUsedFileQuota: async () => 42,
      dataPath: normalizedDataPath
    });

    expect(result.totalSpace).toBe(500);
    expect(result.usedSpace).toBe(120);
    expect(result.freeSpace).toBe(380);
    expect(result.dodecagonUsedSpace).toBe(42);
  });
});
