import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { testTrafficCheck } from './test-traffic.ts';

describe('testTrafficCheck', () => {
  it('matches only the exact token', () => {
    const isTest = testTrafficCheck('s3cret-token');
    expect(isTest({ 'x-vt-test': 's3cret-token' })).toBe(true);
    for (const value of ['s3cret-toke', 's3cret-token ', 'S3CRET-TOKEN', '', undefined])
      expect(isTest({ 'x-vt-test': value })).toBe(false);
    expect(isTest({ 'x-vt-test': ['s3cret-token', 's3cret-token'] })).toBe(false);
    expect(isTest({})).toBe(false);
  });

  it('treats nothing as test traffic without a token', () => {
    for (const token of [null, undefined, '']) {
      const isTest = testTrafficCheck(token);
      expect(isTest({ 'x-vt-test': '' })).toBe(false);
      expect(isTest({ 'x-vt-test': 'anything' })).toBe(false);
    }
  });

  it('reads STATS_IGNORE_TOKEN from the environment', () => {
    expect(loadConfig({}).statsIgnoreToken).toBeNull();
    expect(loadConfig({ STATS_IGNORE_TOKEN: '  ' }).statsIgnoreToken).toBeNull();
    expect(loadConfig({ STATS_IGNORE_TOKEN: ' abc ' }).statsIgnoreToken).toBe('abc');
    expect(loadConfig({}).roomCreateLimit).toBe(20);
    expect(loadConfig({ ROOM_CREATE_LIMIT: '1000' }).roomCreateLimit).toBe(1000);
  });
});
