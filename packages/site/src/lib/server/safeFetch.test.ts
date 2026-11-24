import { expect, test } from 'bun:test';
import { isPrivateAddress } from './safeFetch';

test('internal addresses are blocked, public ones allowed', () => {
	for (const ip of [
		'127.0.0.1',
		'10.1.2.3',
		'172.20.0.5',
		'192.168.1.1',
		'169.254.169.254',
		'100.64.0.1',
		'0.0.0.0',
		'::1',
		'fd00::1',
		'fe80::1',
		'::ffff:127.0.0.1'
	])
		expect(isPrivateAddress(ip)).toBe(true);
	for (const ip of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700::1111', '::ffff:8.8.8.8'])
		expect(isPrivateAddress(ip)).toBe(false);
});
