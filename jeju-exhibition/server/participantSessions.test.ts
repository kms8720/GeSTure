import assert from 'node:assert/strict';
import test from 'node:test';

import { PARTICIPANT_RECONNECT_GRACE_MS, ParticipantSessions } from './participantSessions.js';

test('five participants receive unique fingers and the sixth waits', () =>
{
  const sessions = new ParticipantSessions();
  const fingers = Array.from({ length: 5 }, (_, index) =>
    sessions.join(`token-${index}`, `socket-${index}`).state.finger);

  assert.deepEqual(fingers, ['thumb', 'index', 'middle', 'ring', 'pinky']);
  assert.equal(sessions.join('token-5', 'socket-5').state.status, 'waiting');
  assert.equal(sessions.getSummary().waitingCount, 1);
});

test('a participant reclaims the same finger inside the grace period', () =>
{
  const sessions = new ParticipantSessions();
  sessions.join('token-a', 'socket-a');
  sessions.disconnect('socket-a', 1_000);

  assert.equal(sessions.getControllerState(2_000).thumb.status, 'reconnecting');
  sessions.expire(1_000 + PARTICIPANT_RECONNECT_GRACE_MS - 1);
  assert.equal(sessions.join('token-a', 'socket-b').state.finger, 'thumb');
  assert.equal(sessions.getAssignedFinger('token-a', 'socket-a'), null);
  assert.equal(sessions.getAssignedFinger('token-a', 'socket-b'), 'thumb');
});

test('an expired slot resets and promotes the first connected waiter', () =>
{
  const sessions = new ParticipantSessions();
  for (let index = 0; index < 5; index += 1)
  {
    sessions.join(`token-${index}`, `socket-${index}`);
  }
  sessions.join('waiting-a', 'waiting-socket-a');
  sessions.join('waiting-b', 'waiting-socket-b');

  sessions.disconnect('socket-0', 1_000);
  const [expired] = sessions.expire(1_000 + PARTICIPANT_RECONNECT_GRACE_MS);

  assert.equal(expired.releasedFinger, 'thumb');
  assert.equal(expired.promotedToken, 'waiting-a');
  assert.equal(sessions.getState('waiting-a').finger, 'thumb');
  assert.equal(sessions.getState('waiting-b').queuePosition, 1);
});

test('updates are authorized by both session token and current socket', () =>
{
  const sessions = new ParticipantSessions();
  sessions.join('token-a', 'socket-a');

  assert.equal(sessions.getAssignedFinger('token-a', 'socket-a'), 'thumb');
  assert.equal(sessions.getAssignedFinger('token-a', 'socket-other'), null);
  assert.equal(sessions.getAssignedFinger('token-other', 'socket-a'), null);
});

test('a disconnected waiter takes a free slot when it reconnects', () =>
{
  const sessions = new ParticipantSessions();
  for (let index = 0; index < 5; index += 1)
  {
    sessions.join(`token-${index}`, `socket-${index}`);
  }
  sessions.join('waiting-token', 'waiting-socket');
  sessions.disconnect('waiting-socket', 1_000);
  sessions.release('token-0');

  assert.equal(sessions.getControllerState().thumb.status, 'available');
  assert.equal(sessions.join('waiting-token', 'waiting-socket-new').state.finger, 'thumb');
  assert.equal(sessions.getSummary().waitingCount, 0);
});

test('a socket cannot leak slots by joining with different tokens', () =>
{
  const sessions = new ParticipantSessions();
  sessions.join('first-token', 'same-socket');
  for (let index = 0; index < 4; index++)
  {
    assert.throws(() => sessions.join(`other-token-${index}`, 'same-socket'));
  }
  assert.equal(sessions.getSummary().occupiedCount, 1);
  sessions.disconnect('same-socket', 1000);
  sessions.expire(1000 + PARTICIPANT_RECONNECT_GRACE_MS);
  assert.equal(sessions.getSummary().occupiedCount, 0);
});

test('an old tab disconnect cannot detach a replacement connection', () =>
{
  const sessions = new ParticipantSessions();
  sessions.join('shared-token', 'old-socket');
  assert.equal(sessions.join('shared-token', 'new-socket').replacedSocketId, 'old-socket');
  sessions.disconnect('old-socket', 1000);
  sessions.expire(1000 + PARTICIPANT_RECONNECT_GRACE_MS);
  assert.equal(sessions.getAssignedFinger('shared-token', 'new-socket'), 'thumb');
  sessions.release('shared-token');
  assert.equal(sessions.join('another-token', 'new-socket').state.finger, 'thumb');
});

test('disconnected waiters retain order on reconnect and are skipped during promotion', () =>
{
  const sessions = new ParticipantSessions();
  for (let i = 0; i < 8; i++) sessions.join(`token-${i}`, `socket-${i}`);
  sessions.disconnect('socket-5', 1000);
  assert.equal(sessions.release('token-0').promotedToken, 'token-6');
  sessions.join('token-5', 'socket-5-new');
  assert.equal(sessions.getState('token-5').queuePosition, 1);
  assert.equal(sessions.release('token-1').promotedToken, 'token-5');
  assert.equal(sessions.release('token-2').promotedToken, 'token-7');
});
