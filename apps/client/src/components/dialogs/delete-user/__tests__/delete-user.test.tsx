import { describe, expect, test } from 'bun:test';

const renderDeleteUser = () => {
  const result = Bun.spawnSync({
    cmd: ['bun', 'run', './delete-user.render.tsx'],
    cwd: import.meta.dir,
    stdout: 'pipe',
    stderr: 'pipe'
  });

  if (!result.success) {
    throw new Error(result.stderr.toString());
  }

  const output = result.stdout.toString();
  const marker = output.indexOf('__MARKUP__');

  if (marker === -1) {
    throw new Error(`no markup in the render output:\n${output}`);
  }

  return output.slice(marker + '__MARKUP__'.length).trim();
};

describe('DeleteUserDialog', () => {
  test('should keep the destructive action locked until the word is typed', () => {
    const html = renderDeleteUser();

    expect(html).toContain('bg-danger-solid text-white');
    expect(html).toContain('disabled="">Delete user</button>');
    expect(html).not.toContain('disabled="">Cancel</button>');
  });
});
