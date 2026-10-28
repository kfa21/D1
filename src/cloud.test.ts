// Cloud backup helpers: config parsing from whatever the user pastes, the
// error translation a non-cloud user actually needs, and the guard that stops
// a save before the SDK is connected. No network and no Firebase SDK here.

import { describe, expect, it } from 'vitest';
import {
  CLOUD_RULES,
  MAX_PAYLOAD_BYTES,
  cloudSave,
  describeCloudError,
  isConfigured,
  parseFirebaseConfig,
} from './cloud';

describe('parseFirebaseConfig', () => {
  it('parses the firebaseConfig snippet from the console', () => {
    const pasted = `const firebaseConfig = {
  apiKey: "AIzaSyExample123",
  authDomain: "rams-suite.firebaseapp.com",
  projectId: "rams-suite",
  storageBucket: "rams-suite.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc"
};`;
    expect(parseFirebaseConfig(pasted)).toEqual({
      apiKey: 'AIzaSyExample123',
      authDomain: 'rams-suite.firebaseapp.com',
      projectId: 'rams-suite',
    });
  });

  it('parses single-quoted, unquoted-key and JSON forms', () => {
    const single = "apiKey: 'AIzaA', authDomain: 'a.firebaseapp.com', projectId: 'a'";
    expect(parseFirebaseConfig(single)?.projectId).toBe('a');

    const jsonQuoted = '{"apiKey":"AIzaB","authDomain":"b.firebaseapp.com","projectId":"b"}';
    expect(parseFirebaseConfig(jsonQuoted)?.apiKey).toBe('AIzaB');

    const unquoted = '{ apiKey: "AIzaC", authDomain: "c.firebaseapp.com", projectId: "c" }';
    expect(parseFirebaseConfig(unquoted)?.authDomain).toBe('c.firebaseapp.com');
  });

  it('returns null when a required value is missing or the text is junk', () => {
    expect(parseFirebaseConfig('')).toBeNull();
    expect(parseFirebaseConfig('just some prose about firebase')).toBeNull();
    expect(parseFirebaseConfig('apiKey: "AIzaOnly"')).toBeNull();
    expect(parseFirebaseConfig('projectId: "x"')).toBeNull();
  });
});

describe('isConfigured', () => {
  it('requires all three values', () => {
    expect(isConfigured(null)).toBe(false);
    expect(isConfigured(undefined)).toBe(false);
    expect(isConfigured({ apiKey: '', authDomain: 'x.firebaseapp.com', projectId: 'x' })).toBe(false);
    expect(isConfigured({ apiKey: 'k', authDomain: 'x.firebaseapp.com', projectId: '' })).toBe(false);
    expect(isConfigured({ apiKey: 'k', authDomain: 'x.firebaseapp.com', projectId: 'x' })).toBe(true);
  });
});

describe('describeCloudError', () => {
  it('turns Firebase codes into an actionable sentence', () => {
    expect(describeCloudError('permission-denied')).toMatch(/security rules/);
    expect(describeCloudError('failed-precondition')).toMatch(/Create database/);
    expect(describeCloudError('auth/operation-not-allowed')).toMatch(/Anonymous/);
    expect(describeCloudError('auth/invalid-api-key')).toMatch(/API key/);
    expect(describeCloudError('unavailable')).toMatch(/unreachable/);
    expect(describeCloudError('payload-too-large')).toMatch(new RegExp(String(MAX_PAYLOAD_BYTES / 1000)));
  });

  it('falls back to the code, with the message when there is one', () => {
    expect(describeCloudError('some/unknown', 'boom')).toBe('some/unknown: boom');
    expect(describeCloudError('')).toBe('Unknown cloud error.');
  });
});

describe('CLOUD_RULES', () => {
  it('scopes every operation to the signed-in uid and the project collection', () => {
    expect(CLOUD_RULES).toContain('staticsuite_projects/{docId}');
    expect(CLOUD_RULES).toContain('request.auth != null');
    expect(CLOUD_RULES).toContain('resource.data.userId == request.auth.uid');
    expect(CLOUD_RULES).toContain('request.resource.data.userId == request.auth.uid');
    expect(CLOUD_RULES).not.toMatch(/allow (read|write|delete): if true/);
  });
});

describe('cloudSave', () => {
  it('refuses to run before connect, with a message that says what to do', async () => {
    await expect(cloudSave({ name: 'p', payload: '{}', tags: 0 })).rejects.toThrow(/press Connect/);
  });
});
