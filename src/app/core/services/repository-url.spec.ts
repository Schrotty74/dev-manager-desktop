import {describe, expect, it} from 'vitest';
import {normalizeRepositoryUrl} from './repository-url';

describe('normalizeRepositoryUrl', () => {
    it('trims URLs and converts GitHub repository and blob links to raw URLs', () => {
        expect(normalizeRepositoryUrl(' https://example.com/catalog.json?x=1 ')).toBe('https://example.com/catalog.json?x=1');
        expect(normalizeRepositoryUrl('https://github.com/owner/sample-catalog')).toBe('https://raw.githubusercontent.com/owner/sample-catalog/HEAD/repo.json');
        expect(normalizeRepositoryUrl('https://github.com/owner/repo/blob/main/catalog.json?x=1'))
            .toBe('https://raw.githubusercontent.com/owner/repo/main/catalog.json?x=1');
    });

    it.each(['http://example.com/catalog.json', 'https://user:pass@example.com/catalog.json',
        'https://example.com/catalog.json#section', 'https://example.com/a b.json'])('rejects %s', value => {
        expect(() => normalizeRepositoryUrl(value)).toThrow();
    });
});
