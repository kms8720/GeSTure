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
