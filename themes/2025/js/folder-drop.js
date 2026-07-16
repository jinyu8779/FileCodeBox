/**
 * 文件夹拖拽工具：递归读取 DataTransfer 中的目录与文件
 */
const FolderDrop = {
    /**
     * 从拖拽数据中读取全部文件（支持文件夹）
     * @param {DataTransfer} dataTransfer
     * @returns {Promise<{files: File[], hasDirectory: boolean}>}
     */
    async readFilesFromDataTransfer(dataTransfer) {
        const items = dataTransfer.items;
        if (!items || items.length === 0) {
            return {
                files: Array.from(dataTransfer.files || []),
                hasDirectory: false,
            };
        }

        const files = [];
        let hasDirectory = false;
        const tasks = [];

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (!item) continue;
            const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
            if (!entry) {
                const file = item.getAsFile && item.getAsFile();
                if (file) files.push(file);
                continue;
            }
            if (entry.isDirectory) {
                hasDirectory = true;
            }
            tasks.push(this.readEntry(entry, '', files));
        }

        await Promise.all(tasks);
        return { files, hasDirectory };
    },

    readEntry(entry, pathPrefix, out) {
        if (entry.isFile) {
            return new Promise((resolve, reject) => {
                entry.file(
                    (file) => {
                        const relativePath = pathPrefix
                            ? `${pathPrefix}/${file.name}`
                            : file.name;
                        try {
                            Object.defineProperty(file, 'webkitRelativePath', {
                                value: relativePath,
                                writable: false,
                            });
                        } catch (e) {
                            // ignore
                        }
                        out.push(file);
                        resolve();
                    },
                    (err) => reject(err)
                );
            });
        }

        if (entry.isDirectory) {
            const dirReader = entry.createReader();
            const nextPath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
            return this.readAllDirectoryEntries(dirReader).then((entries) =>
                Promise.all(entries.map((child) => this.readEntry(child, nextPath, out)))
            );
        }

        return Promise.resolve();
    },

    readAllDirectoryEntries(reader) {
        const entries = [];
        return new Promise((resolve, reject) => {
            const readBatch = () => {
                reader.readEntries(
                    (batch) => {
                        if (!batch.length) {
                            resolve(entries);
                            return;
                        }
                        entries.push(...batch);
                        readBatch();
                    },
                    (err) => reject(err)
                );
            };
            readBatch();
        });
    },

    getFolderName(files) {
        if (!files || !files.length) return 'folder';
        const first = files[0];
        if (first.webkitRelativePath) {
            return first.webkitRelativePath.split('/')[0] || 'folder';
        }
        return 'folder';
    },

    totalSize(files) {
        return Array.from(files || []).reduce((sum, f) => sum + (f.size || 0), 0);
    },
};
