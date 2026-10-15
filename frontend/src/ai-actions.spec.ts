import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
    getFile: vi.fn<(path: string) => Promise<{ content: string | null; etag: string }>>(),
    saveFileChecked: vi.fn<(path: string, content: string, expectedETag: string) => Promise<void>>(
        async () => undefined),
}));

vi.mock('@/api', () => apiMocks);

import { AI_ACTIONS_PATH, updateAiActions } from '@/ai-actions';

const FILE = `[summarize]
name = "Summarize"
prompt = """
Summarize {{input}}"""

[translate]
name = "Text/Translate"
prompt = """
Translate {{input}}"""
`;

const status = (code: number) => Object.assign(new Error(`Request failed with status code ${code}`), {
    isAxiosError: true,
    response: { status: code },
});

const added = { id: 'fix', name: 'Fix', prompt: 'Fix {{input}}' };

beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
});

describe('updateAiActions', () => {
    it('makes the change to the file as it is now, checked against the version read', async () => {
        apiMocks.getFile.mockResolvedValue({ content: FILE, etag: '"read"' });

        const written = await updateAiActions((current) => [...current, added]);

        expect(written.map(({ id }) => id)).toEqual(['summarize', 'translate', 'fix']);
        const [path, content, etag] = apiMocks.saveFileChecked.mock.calls[0];
        expect(path).toBe(AI_ACTIONS_PATH);
        expect(content).toContain('[summarize]');
        expect(content).toContain('[translate]');
        expect(content).toContain('[fix]');
        expect(etag).toBe('"read"');
    });

    it('creates the file when there is none', async () => {
        apiMocks.getFile.mockRejectedValue(status(404));

        await updateAiActions((current) => [...current, added]);

        expect(apiMocks.saveFileChecked)
            .toHaveBeenCalledWith(AI_ACTIONS_PATH, expect.stringContaining('[fix]'), 'absent');
    });

    // A view that could not read the file holds no actions, and the file written from that would
    // hold only the one being added.
    it('writes nothing when the file cannot be read', async () => {
        apiMocks.getFile.mockRejectedValue(status(500));

        await expect(updateAiActions((current) => [...current, added])).rejects.toThrow('status code 500');
        expect(apiMocks.saveFileChecked).not.toHaveBeenCalled();
    });

    it('writes nothing over a file that is not TOML', async () => {
        apiMocks.getFile.mockResolvedValue({ content: `${FILE}[unclosed\n`, etag: '"read"' });

        await expect(updateAiActions((current) => [...current, added])).rejects.toThrow();
        expect(apiMocks.saveFileChecked).not.toHaveBeenCalled();
    });

    // The menu does without a table it cannot run, but writing the file back without it deletes it.
    it('writes nothing over a table that is not an action', async () => {
        const content = `${FILE}\n[draft]\nname = "Half written"\n`;
        apiMocks.getFile.mockResolvedValue({ content, etag: '"read"' });

        await expect(updateAiActions((current) => [...current, added])).rejects.toThrow('draft');
        expect(apiMocks.saveFileChecked).not.toHaveBeenCalled();
    });

    it('writes nothing over a key of an action it does not know', async () => {
        const content = FILE.replace('name = "Summarize"', 'name = "Summarize"\nmodel = "small"');
        apiMocks.getFile.mockResolvedValue({ content, etag: '"read"' });

        await expect(updateAiActions((current) => [...current, added])).rejects.toThrow('summarize.model');
        expect(apiMocks.saveFileChecked).not.toHaveBeenCalled();
    });

    it('writes nothing that gives two actions one identifier', async () => {
        apiMocks.getFile.mockResolvedValue({ content: FILE, etag: '"read"' });

        const taken = { ...added, id: 'summarize' };
        await expect(updateAiActions((current) => [...current, taken])).rejects.toThrow('summarize');
        expect(apiMocks.saveFileChecked).not.toHaveBeenCalled();
    });

    it('says so when the file changed while saving', async () => {
        apiMocks.getFile.mockResolvedValue({ content: FILE, etag: '"read"' });
        apiMocks.saveFileChecked.mockRejectedValueOnce(status(412));

        await expect(updateAiActions((current) => [...current, added])).rejects.toThrow('changed while saving');
    });
});
