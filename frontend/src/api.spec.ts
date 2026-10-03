import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
    get: vi.fn(),
    put: vi.fn(),
    head: vi.fn(),
    delete: vi.fn(),
}));

vi.mock('@/axios', () => ({ getAxios: () => client }));

import { addNote, deleteNote, getNote, getTaskData, noteExists, renameNote } from '@/api';

// A path with the characters that end a URL's path early when they are not encoded.
const ODD_PATH = 'notes/name#draft?100%.md';
const ENCODED_ODD_PATH = 'notes/name%23draft%3F100%25.md';

// Which URL each call asks for is what is under test, so the answers are only what the callers
// read.
beforeEach(() => {
    vi.resetAllMocks();
    client.get.mockResolvedValue({ status: 200, data: '' });
    client.put.mockResolvedValue({ status: 200, data: null });
    client.head.mockResolvedValue({ status: 200 });
    client.delete.mockResolvedValue({ status: 200, data: true });
});

describe('the requests for a note', () => {
    it('reads a note by its encoded path', async () => {
        await getNote(ODD_PATH);
        expect(client.get).toHaveBeenCalledWith(`/notes/${ENCODED_ODD_PATH}`);
    });

    it('saves a note to its encoded path', async () => {
        await addNote(ODD_PATH, 'content');
        expect(client.put.mock.calls[0][0]).toBe(`/notes/${ENCODED_ODD_PATH}`);
    });

    // The new path is in the URL and the old one in the body, which is a path as it is.
    it('renames to the encoded new path and names the old one as it is', async () => {
        await renameNote('notes/old#1.md', ODD_PATH);
        expect(client.put).toHaveBeenCalledWith(`/notes/${ENCODED_ODD_PATH}`, { Rename: { from: 'notes/old#1.md' } });
    });

    it('deletes a note by its encoded path', async () => {
        await deleteNote(ODD_PATH);
        expect(client.delete).toHaveBeenCalledWith(`/notes/${ENCODED_ODD_PATH}`);
    });

    it('asks whether a path exists by its encoded path', async () => {
        await noteExists(ODD_PATH);
        expect(client.head.mock.calls[0][0]).toBe(`/v2/files/${ENCODED_ODD_PATH}`);
    });

    it('keeps the slashes of an ordinary path', async () => {
        await getNote('research/programming-learning/codewalker.md');
        expect(client.get).toHaveBeenCalledWith('/notes/research/programming-learning/codewalker.md');
    });
});


describe('legacy task archive', () => {
    const data = 'tasks:\n    backlog: []\n    scheduled: {}\ngroups: []\n';

    it('reads the renamed archive first', async () => {
        client.get.mockResolvedValue({ status: 200, data, headers: { etag: 'archive' } });
        const [etag, archive] = await getTaskData();
        expect(etag).toBe('archive');
        expect(archive?.tasks.backlog).toEqual([]);
        expect(client.get.mock.calls[0][0]).toBe('/v2/files/.mory/tasks-v1.yaml');
        expect(client.get).toHaveBeenCalledTimes(1);
    });

    it('reads the old path only when the archive is missing', async () => {
        client.get.mockRejectedValueOnce({ isAxiosError: true, response: { status: 404 } });
        client.get.mockResolvedValueOnce({ status: 200, data, headers: { etag: 'old' } });
        await getTaskData();
        expect(client.get.mock.calls[1][0]).toBe('/v2/files/.mory/tasks.yaml');
    });

    it('does not create a file when neither path exists', async () => {
        client.get.mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
        await expect(getTaskData()).rejects.toMatchObject({ response: { status: 404 } });
        expect(client.put).not.toHaveBeenCalled();
    });

    it('does not fall back after an authorization failure', async () => {
        client.get.mockRejectedValue({ isAxiosError: true, response: { status: 401 } });
        await expect(getTaskData()).rejects.toMatchObject({ response: { status: 401 } });
        expect(client.get).toHaveBeenCalledTimes(1);
    });
});
