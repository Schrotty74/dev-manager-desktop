/** Normalize a user supplied Glasshouse compatible catalog URL. */
export function normalizeRepositoryUrl(value: string): string {
    if (typeof value !== 'string' || /[\s\u0000-\u001f\u007f]/.test(value.trim())) {
        throw new Error('Repository URL must be a valid HTTPS URL.');
    }
    const trimmed = value.trim();
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new Error('Repository URL must be a valid HTTPS URL.');
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
        throw new Error('Repository URL must use HTTPS and cannot contain credentials or a fragment.');
    }
    if (parsed.hostname.toLowerCase() === 'github.com') {
        const parts = parsed.pathname.split('/').filter(Boolean);
        if (parts.length === 2) {
            return `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/HEAD/repo.json`;
        }
        if (parts.length >= 5 && parts[2] === 'blob') {
            return `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${parts.slice(3).join('/')}${parsed.search}`;
        }
    }
    return parsed.toString();
}
