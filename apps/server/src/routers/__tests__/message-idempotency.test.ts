import { Permission, sha256 } from '@dodecagon/shared';
import { describe, expect, spyOn, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { initTest, uploadFile } from '../../__tests__/helpers';
import { tdb } from '../../__tests__/setup';
import {
  messageFiles,
  messages,
  messageSendRequests,
  rolePermissions,
  settings
} from '../../db/schema';
import { fileManager } from '../../helpers/file-manager';
import { eventBus } from '../../plugins/event-bus';

const request = {
  channelId: 1,
  content: '<p>Only once</p>',
  clientRequestId: '42dd19b0-c127-4144-a742-68ec95d3940b'
};

describe('message send idempotency', () => {
  test('persists one row and emits once for concurrent and later replays', async () => {
    const { caller } = await initTest();
    const emit = spyOn(eventBus, 'emit');
    const ids = await Promise.all([
      caller.messages.send(request),
      caller.messages.send(request)
    ]);
    expect(ids[0]).toBe(ids[1]);
    expect(await caller.messages.send(request)).toBe(ids[0]);
    const rows = await tdb
      .select()
      .from(messages)
      .where(eq(messages.clientRequestId, request.clientRequestId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content).toBe(request.content);
    expect(
      emit.mock.calls.filter(([event]) => event === 'message:created')
    ).toHaveLength(1);
  });

  test('scopes identical request IDs to the authenticated user', async () => {
    const { caller: first } = await initTest(1);
    const { caller: second } = await initTest(2);
    const firstId = await first.messages.send(request);
    const secondId = await second.messages.send(request);
    expect(firstId).not.toBe(secondId);
    expect(await second.messages.send(request)).toBe(secondId);
    const actual = await second.messages.getOne({ messageId: secondId });
    expect(actual.userId).toBe(2);
  });

  test('does not retain plaintext content or recreate a deleted successful send', async () => {
    const { caller } = await initTest();
    const id = await caller.messages.send(request);
    const receipt = await tdb
      .select()
      .from(messageSendRequests)
      .where(eq(messageSendRequests.clientRequestId, request.clientRequestId))
      .get();
    const fingerprint = await sha256(
      JSON.stringify({
        content: request.content,
        channelId: request.channelId,
        files: [],
        parentMessageId: null,
        replyToMessageId: null
      })
    );
    expect(receipt?.payload).toBe(fingerprint);
    expect(receipt?.failure).toBe('completed');
    await caller.messages.delete({ messageId: id });
    await expect(caller.messages.send(request)).rejects.toThrow(
      'The sent message no longer exists.'
    );
    const rows = await tdb
      .select()
      .from(messages)
      .where(eq(messages.clientRequestId, request.clientRequestId));
    expect(rows).toHaveLength(0);
  });

  test('rejects reuse with edited content, channel, attachment or reply payload', async () => {
    const { caller } = await initTest();
    await caller.messages.send(request);
    for (const changed of [
      { content: '<p>Edited</p>' },
      { channelId: 2 },
      { files: ['different-file'] },
      { replyToMessageId: 1 },
      { parentMessageId: 1 }
    ]) {
      await expect(
        caller.messages.send({ ...request, ...changed })
      ).rejects.toThrow(
        'This request ID was already used for a different message.'
      );
    }
  });

  test('checks permissions again before returning a successful replay', async () => {
    const { caller } = await initTest(2);
    await caller.messages.send(request);
    await tdb
      .delete(rolePermissions)
      .where(
        and(
          eq(rolePermissions.roleId, 2),
          eq(rolePermissions.permission, Permission.SEND_MESSAGES)
        )
      );
    await expect(caller.messages.send(request)).rejects.toThrow(
      'Insufficient permissions'
    );
  });

  test('recovers a successful reply after its original target is deleted', async () => {
    const { caller } = await initTest();
    const input = { ...request, replyToMessageId: 1 };
    const id = await caller.messages.send(input);
    await caller.messages.delete({ messageId: 1 });
    const actual = await caller.messages.getOne({ messageId: id });
    expect(actual.replyToMessageId).toBeNull();
    expect(await caller.messages.send(input)).toBe(id);
  });

  test('replays an attachment send after the temporary file was consumed', async () => {
    const { caller, mockedToken } = await initTest();
    const response = await uploadFile(
      new File(['attachment'], 'attachment.txt', { type: 'text/plain' }),
      mockedToken
    );
    const file = (await response.json()) as { id: string };
    const input = { ...request, files: [file.id] };
    const [id, concurrentId] = await Promise.all([
      caller.messages.send(input),
      caller.messages.send(input)
    ]);
    expect(concurrentId).toBe(id);
    expect(await caller.messages.send(input)).toBe(id);
    const attachments = await tdb
      .select()
      .from(messageFiles)
      .where(eq(messageFiles.messageId, id));
    expect(attachments).toHaveLength(1);
    const actual = await caller.messages.getOne({ messageId: id });
    expect(actual.clientRequestId).toBe(request.clientRequestId);
    expect(actual.files).toHaveLength(1);
  });

  test('a safely rejected upload remains retryable with its original attachment', async () => {
    const { caller, mockedToken } = await initTest();
    const response = await uploadFile(
      new File(['attachment'], 'retry.txt', { type: 'text/plain' }),
      mockedToken
    );
    const file = (await response.json()) as { id: string };
    const input = { ...request, files: [file.id] };
    await tdb.update(settings).set({ storageUploadEnabled: false });
    await expect(caller.messages.send(input)).rejects.toThrow(
      'File uploads are disabled on this server'
    );
    const claims = await tdb
      .select()
      .from(messageSendRequests)
      .where(eq(messageSendRequests.clientRequestId, request.clientRequestId));
    expect(claims).toHaveLength(0);
    await tdb.update(settings).set({ storageUploadEnabled: true });
    const id = await caller.messages.send(input);
    const actual = await caller.messages.getOne({ messageId: id });
    expect(actual.files).toHaveLength(1);
  });

  test('expired uploads are rejected before claiming and fresh uploads can be explicitly sent', async () => {
    const { caller, mockedToken } = await initTest();
    const source = new File(['attachment'], 'expired.txt', {
      type: 'text/plain'
    });
    const response = await uploadFile(source, mockedToken);
    const file = (await response.json()) as { id: string };
    await fileManager.removeTemporaryFile(file.id);
    await expect(
      caller.messages.send({ ...request, files: [file.id] })
    ).rejects.toThrow('Temporary attachment expired.');
    const claims = await tdb
      .select()
      .from(messageSendRequests)
      .where(eq(messageSendRequests.clientRequestId, request.clientRequestId));
    expect(claims).toHaveLength(0);
    const replacementResponse = await uploadFile(source, mockedToken);
    const replacement = (await replacementResponse.json()) as { id: string };
    const id = await caller.messages.send({
      ...request,
      clientRequestId: 'ed5d5d5a-14a7-46e0-aae7-52a6a6df1f11',
      files: [replacement.id]
    });
    const actual = await caller.messages.getOne({ messageId: id });
    expect(actual.files).toHaveLength(1);
  });

  test('checks every attachment owner before claiming or consuming any file', async () => {
    const { mockedToken: ownerToken } = await initTest(1);
    const { caller, mockedToken } = await initTest(2);
    const ownResponse = await uploadFile(
      new File(['own'], 'own.txt', { type: 'text/plain' }),
      mockedToken
    );
    const foreignResponse = await uploadFile(
      new File(['foreign'], 'foreign.txt', { type: 'text/plain' }),
      ownerToken
    );
    const own = (await ownResponse.json()) as { id: string };
    const foreign = (await foreignResponse.json()) as { id: string };
    await expect(
      caller.messages.send({ ...request, files: [own.id, foreign.id] })
    ).rejects.toThrow("You don't have permission to access this file");
    const claims = await tdb
      .select()
      .from(messageSendRequests)
      .where(eq(messageSendRequests.clientRequestId, request.clientRequestId));
    expect(claims).toHaveLength(0);
    expect(fileManager.temporaryFileExists(own.id)).toBe(true);
    expect(fileManager.temporaryFileExists(foreign.id)).toBe(true);
  });

  test('returns the actual sanitized result for reconciliation', async () => {
    const { caller } = await initTest();
    const id = await caller.messages.send({
      ...request,
      content: '<p>Safe</p><script>bad()</script>'
    });
    const result = await caller.messages.getOne({ messageId: id });
    expect(result.content).toBe('<p>Safe</p>');
    expect(result.clientRequestId).toBe(request.clientRequestId);
  });
});
