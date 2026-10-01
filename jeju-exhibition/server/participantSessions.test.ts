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

test('finger QR requests assign the exact finger regardless of arrival order', () =>
{
  const sessions = new ParticipantSessions();
  const fingers = ['pinky', 'ring', 'middle', 'index', 'thumb'] as const;
  fingers.forEach((finger) => assert.equal(sessions.join(finger, `socket-${finger}`, finger).state.finger, finger));
  assert.equal(sessions.getSummary().occupiedCount, 5);
});

test('a finger-specific waiter waits for that finger even when other fingers are free', () =>
{
  const sessions = new ParticipantSessions();
  sessions.join('owner', 'owner-socket', 'thumb');
  const waiting = sessions.join('waiting', 'waiting-socket', 'thumb').state;
  assert.equal(waiting.status, 'waiting');
  assert.equal(waiting.finger, null);
  assert.equal(sessions.getControllerState().index.status, 'available');
  sessions.join('index-owner', 'index-owner-socket', 'index');
  assert.equal(sessions.release('index-owner').promotedToken, null);
  assert.equal(sessions.release('owner').promotedToken, 'waiting');
  assert.equal(sessions.getState('waiting').finger, 'thumb');
});

test('queue positions and promotion are scoped to the requested finger', () =>
{
  const sessions = new ParticipantSessions();
  sessions.join('thumb-owner', 'thumb-owner-socket', 'thumb');
  sessions.join('index-owner', 'index-owner-socket', 'index');
  sessions.join('thumb-a', 'thumb-a-socket', 'thumb');
  sessions.join('index-a', 'index-a-socket', 'index');
  sessions.join('thumb-b', 'thumb-b-socket', 'thumb');
  assert.equal(sessions.getState('thumb-a').queuePosition, 1);
  assert.equal(sessions.getState('index-a').queuePosition, 1);
  assert.equal(sessions.getState('thumb-b').queuePosition, 2);
  assert.equal(sessions.release('index-owner').promotedToken, 'index-a');
  assert.equal(sessions.getState('thumb-a').status, 'waiting');
  assert.equal(sessions.release('thumb-owner').promotedToken, 'thumb-a');
  assert.equal(sessions.getState('thumb-b').queuePosition, 1);
});

test('scanning another finger QR transfers one session and promotes the old finger queue', () =>
{
  const sessions = new ParticipantSessions();
  sessions.join('owner', 'old-socket', 'thumb');
  sessions.join('waiting', 'waiting-socket', 'thumb');
  const changed = sessions.join('owner', 'new-socket', 'pinky');
  assert.equal(changed.releasedFinger, 'thumb');
  assert.equal(changed.replacedSocketId, 'old-socket');
  assert.equal(changed.state.finger, 'pinky');
  assert.equal(sessions.getState('waiting').finger, 'thumb');
  assert.equal(sessions.getSummary().occupiedCount, 2);
  assert.equal(sessions.getAssignedFinger('owner', 'old-socket'), null);
  sessions.disconnect('old-socket', 1000);
  assert.equal(sessions.getAssignedFinger('owner', 'new-socket'), 'pinky');
});

test('requesting the current auto-assigned finger keeps ownership and a new QR changes a waiting preference', () =>
{
  const sessions = new ParticipantSessions();
  sessions.join('owner', 'owner-socket');
  sessions.join('waiting', 'waiting-socket', 'thumb');
  assert.equal(sessions.join('owner', 'owner-socket', 'thumb').releasedFinger, null);
  assert.equal(sessions.getState('owner').finger, 'thumb');
  assert.equal(sessions.getState('waiting').status, 'waiting');
  assert.equal(sessions.join('waiting', 'waiting-socket', 'middle').state.finger, 'middle');
  assert.equal(sessions.getSummary().waitingCount, 0);
});
