import { describe, expect, test } from 'bun:test';
import { parseCommandArgs } from '../parse-command-args';

describe('parseCommandArgs', () => {
  test('handles quoted arguments with spaces', () => {
    expect(parseCommandArgs('/ban user123 "reason with spaces"')).toEqual({
      commandName: 'ban',
      args: ['user123', 'reason with spaces']
    });
  });

  test('handles single quoted arguments', () => {
    expect(parseCommandArgs("/mute user123 'quiet please'")).toEqual({
      commandName: 'mute',
      args: ['user123', 'quiet please']
    });
  });

  test('handles mixed quoted and unquoted arguments', () => {
    expect(
      parseCommandArgs('/warn user123 "first reason" second "third reason"')
    ).toEqual({
      commandName: 'warn',
      args: ['user123', 'first reason', 'second', 'third reason']
    });
  });
});
