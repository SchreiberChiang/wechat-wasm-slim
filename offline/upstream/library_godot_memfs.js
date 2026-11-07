/**
 * WXMEMFS - 基于 MEMFS 的微信小游戏持久化文件系统
 *
 * 核心设计:
 * 1. 继承 MEMFS 的内存存储模型 (node.contents)
 * 2. 使用 fd-based 索引管理打开的文件流
 * 3. open 时懒加载,close 时自动持久化
 * 4. 写入直接修改 node.contents,立即可读
 * 5. PCK 文件特殊处理: 加载后常驻内存,不自动释放
 *
 * 调试模式:
 * - 默认情况下不输出任何日志
 * - 启用调试: WXMEMFS.debug = true
 * - 禁用调试: WXMEMFS.debug = false
 *
 * GODOTSDK 全局 API:
 * - GODOTSDK.releasePck(godotPath) - 释放指定PCK文件缓存
 * - GODOTSDK.getWxPath(godotPath) - Godot路径转微信路径
 * - GODOTSDK.getGodotPath(wxPath) - 微信路径转Godot路径
 */

var WXMEMFS = {
    // ============ 调试配置 ============
    debug: false,  // 默认关闭调试日志

    // ============ 继承 MEMFS 核心 ============
    ops_table: null,

    // ============ 微信持久化扩展 ============
    mountpoint: '/userfs',  // Godot 实际使用 /userfs 而不是 /user
    wxBasePath: '',  // 初始化时设置为 wx.env.USER_DATA_PATH

    // fd 管理
    openStreams: {},  // wxfd -> {node, wxPath, wxFd, flags, dirty}
    fdCounter: 1000,

    // 引用计数: node -> openCount
    nodeRefCounts: new WeakMap(),

    // 懒加载追踪
    lazyLoadedNodes: new WeakSet(),

    // ============ PCK 缓存管理 ============
    // PCK 文件特殊处理: 加载后常驻内存,不自动释放
    pckCache: new WeakMap(),  // node -> true (标记为pck文件)
    pckPathCache: {},  // godotPath -> node (用于释放时查找)

    // ============ 日志工具 ============
    log: function () {
        if (WXMEMFS.debug) {
            console.log.apply(console, arguments);
        }
    },

    logError: function () {
        if (WXMEMFS.debug) {
            console.error.apply(console, arguments);
        }
    },

    logWarn: function () {
        if (WXMEMFS.debug) {
            console.warn.apply(console, arguments);
        }
    },

    // ============ 引用计数管理 ============
    incrementRefCount: function (node) {
        var count = WXMEMFS.nodeRefCounts.get(node) || 0;
        WXMEMFS.nodeRefCounts.set(node, count + 1);
        return count + 1;
    },

    decrementRefCount: function (node) {
        var count = WXMEMFS.nodeRefCounts.get(node) || 0;
        if (count > 0) {
            count--;
            WXMEMFS.nodeRefCounts.set(node, count);
        }
        return count;
    },

    getRefCount: function (node) {
        return WXMEMFS.nodeRefCounts.get(node) || 0;
    },

    // 释放 node.contents (当引用计数为 0 时)
    releaseNodeContents: function (node) {
        if (!FS.isFile(node.mode)) return;

        // ✅ 检查是否是 PCK 文件,PCK 文件不释放
        if (WXMEMFS.pckCache.has(node)) {
            WXMEMFS.log('[WXMEMFS] Skip releasing PCK file, kept in memory');
            return;
        }

        var refCount = WXMEMFS.getRefCount(node);
        if (refCount === 0 && node.contents) {
            WXMEMFS.log('[WXMEMFS] Releasing node contents, size:', node.usedBytes);
            node.contents = null;
            node.usedBytes = 0;
            // ✅ 删除 lazyLoadedNodes 标记,允许下次重新加载
            // 因为内存已释放,下次 open 时需要从微信文件系统加载
            WXMEMFS.lazyLoadedNodes.delete(node);
        }
    },

    // ============ 路径转换 ============
    getWxPath: function (fsPath) {
        // fsPath: "/user/testfile.data"
        // return: wx.env.USER_DATA_PATH + "/testfile.data"
        var relativePath = fsPath.startsWith(WXMEMFS.mountpoint)
            ? fsPath.substr(WXMEMFS.mountpoint.length)
            : fsPath;
        return WXMEMFS.wxBasePath + relativePath;
    },

    // ============ 序列化/反序列化 ============

    // 持久化: node.contents -> 微信文件系统
    persistNode: function (node, wxPath) {
        if (!FS.isFile(node.mode)) return;

        try {
            var data = WXMEMFS.getFileDataAsTypedArray(node);

            if (data.length === 0) {
                // 空文件
                wx.getFileSystemManager().writeFileSync(wxPath, '', 'utf-8');
            } else {
                // 二进制数据
                wx.getFileSystemManager().writeFileSync(wxPath, data.buffer);
            }

            WXMEMFS.log('[WXMEMFS] Persisted:', wxPath, data.length, 'bytes');
        } catch (e) {
            WXMEMFS.logError('[WXMEMFS] Persist failed:', wxPath, e.message);
            throw e;
        }
    },

    // 加载: 微信文件系统 -> node.contents
    loadNode: function (node, wxPath) {
        // 检查是否已经有内容在内存中
        if (node.contents !== null && node.contents !== undefined) {
            WXMEMFS.log('[WXMEMFS] Node already has contents, skip loading:', wxPath);
            return;  // 内存中已有数据,无需加载
        }

        // 检查是否已经尝试过加载
        if (WXMEMFS.lazyLoadedNodes.has(node)) {
            WXMEMFS.log('[WXMEMFS] Node already attempted load:', wxPath);
            return;  // 已经尝试过加载(可能失败或成功)
        }

        try {
            // 使用 undefined 作为 encoding,返回 ArrayBuffer
            var buffer = wx.getFileSystemManager().readFileSync(wxPath, undefined, 0);

            if (buffer.byteLength > 0) {
                node.contents = new Uint8Array(buffer);
                node.usedBytes = buffer.byteLength;
            } else {
                node.contents = new Uint8Array(0);
                node.usedBytes = 0;
            }

            WXMEMFS.lazyLoadedNodes.add(node);
            WXMEMFS.log('[WXMEMFS] Loaded:', wxPath, buffer.byteLength, 'bytes');
        } catch (e) {
            // 文件不存在或读取失败
            WXMEMFS.log('[WXMEMFS] Load failed (file may not exist):', wxPath, e.message);

            // 标记为已尝试加载,避免重复尝试
            WXMEMFS.lazyLoadedNodes.add(node);

            // 初始化为空内容
            if (node.contents === null || node.contents === undefined) {
                node.contents = new Uint8Array(0);
                node.usedBytes = 0;
            }
        }
    },

    // ============ 继承 MEMFS 的工具方法 ============

    getFileDataAsTypedArray: function (node) {
        if (!node.contents)
            return new Uint8Array(0);
        if (node.contents.subarray)
            return node.contents.subarray(0, node.usedBytes);
        return new Uint8Array(node.contents);
    },

    expandFileStorage: function (node, newCapacity) {
        var prevCapacity = node.contents ? node.contents.length : 0;
        if (prevCapacity >= newCapacity)
            return;
        var CAPACITY_DOUBLING_MAX = 1024 * 1024;
        newCapacity = Math.max(newCapacity, prevCapacity * (prevCapacity < CAPACITY_DOUBLING_MAX ? 2 : 1.125) >>> 0);
        if (prevCapacity != 0)
            newCapacity = Math.max(newCapacity, 256);
        var oldContents = node.contents;
        node.contents = new Uint8Array(newCapacity);
        if (node.usedBytes > 0)
            node.contents.set(oldContents.subarray(0, node.usedBytes), 0);
    },

    resizeFileStorage: function (node, newSize) {
        if (node.usedBytes == newSize)
            return;
        if (newSize == 0) {
            node.contents = null;
            node.usedBytes = 0;
        } else {
            var oldContents = node.contents;
            node.contents = new Uint8Array(newSize);
            if (oldContents) {
                node.contents.set(oldContents.subarray(0, Math.min(newSize, node.usedBytes)));
            }
            node.usedBytes = newSize;
        }
    },

    // ============ Mount ============

    mount: function (mount) {
        WXMEMFS.mountpoint = mount.mountpoint;

        // 初始化微信基础路径
        if (typeof wx !== 'undefined' && wx.env && wx.env.USER_DATA_PATH) {
            WXMEMFS.wxBasePath = wx.env.USER_DATA_PATH;
        } else {
            WXMEMFS.logWarn('[WXMEMFS] wx.env.USER_DATA_PATH not available, persistence disabled');
            WXMEMFS.wxBasePath = '';
        }

        // 创建根节点
        var root = WXMEMFS.createNode(null, '/', 16384 | 511, 0);

        // 同步微信文件系统
        if (WXMEMFS.wxBasePath) {
            WXMEMFS.syncFromWx(root);
        }

        WXMEMFS.log('[WXMEMFS] Mounted at:', WXMEMFS.mountpoint, 'wx:', WXMEMFS.wxBasePath);
        return root;
    },

    // 从微信文件系统同步到内存树
    syncFromWx: function (root) {
        try {
            var stats = wx.getFileSystemManager().statSync(WXMEMFS.wxBasePath, true);

            if (Array.isArray(stats)) {
                stats.forEach(function (stat) {
                    if (stat.path && stat.path !== '/') {
                        WXMEMFS.createNodeFromWx(root, stat.path, stat.stats);
                    }
                });
                WXMEMFS.log('[WXMEMFS] Synced', stats.length, 'items from wx filesystem');
            }
        } catch (e) {
            WXMEMFS.log('[WXMEMFS] syncFromWx:', e.message);
        }
    },

    createNodeFromWx: function (parent, path, stats) {
        var parts = path.split('/').filter(function (p) { return p.length > 0; });
        var node = parent;

        for (var i = 0; i < parts.length; i++) {
            var part = parts[i];
            var isLast = (i === parts.length - 1);

            try {
                node = FS.lookupNode(node, part);
            } catch (e) {
                // 节点不存在,创建
                var mode;
                if (isLast) {
                    // 根据 stats 判断类型
                    if (stats.isDirectory && stats.isDirectory()) {
                        mode = 16384 | 511;  // 目录
                    } else {
                        mode = 32768 | 438;  // 文件 (0666)
                    }
                } else {
                    mode = 16384 | 511;  // 中间路径都是目录
                }

                node = WXMEMFS.createNode(node, part, mode, 0);

                if (isLast && FS.isFile(mode)) {
                    node.usedBytes = stats.size || 0;
                    if (stats.lastAccessedTime) {
                        node.atime = new Date(stats.lastAccessedTime * 1000);
                    }
                    if (stats.lastModifiedTime) {
                        node.mtime = new Date(stats.lastModifiedTime * 1000);
                    }
                    // 注意: 不立即加载 contents,等 open 时懒加载
                }
            }
        }

        return node;
    },

    // ============ 创建节点 ============

    createNode: function (parent, name, mode, dev) {
        if (FS.isBlkdev(mode) || FS.isFIFO(mode)) {
            throw new FS.ErrnoError(63);
        }

        WXMEMFS.ops_table ||= {
            dir: {
                node: {
                    getattr: WXMEMFS.node_ops.getattr,
                    setattr: WXMEMFS.node_ops.setattr,
                    lookup: WXMEMFS.node_ops.lookup,
                    mknod: WXMEMFS.node_ops.mknod,
                    rename: WXMEMFS.node_ops.rename,
                    unlink: WXMEMFS.node_ops.unlink,
                    rmdir: WXMEMFS.node_ops.rmdir,
                    readdir: WXMEMFS.node_ops.readdir,
                    symlink: WXMEMFS.node_ops.symlink
                },
                stream: {
                    llseek: WXMEMFS.stream_ops.llseek
                }
            },
            file: {
                node: {
                    getattr: WXMEMFS.node_ops.getattr,
                    setattr: WXMEMFS.node_ops.setattr
                },
                stream: {
                    llseek: WXMEMFS.stream_ops.llseek,
                    read: WXMEMFS.stream_ops.read,
                    write: WXMEMFS.stream_ops.write,
                    open: WXMEMFS.stream_ops.open,
                    close: WXMEMFS.stream_ops.close,
                    // 注意: 不实现 mmap/msync,简化设计
                }
            },
            link: {
                node: {
                    getattr: WXMEMFS.node_ops.getattr,
                    setattr: WXMEMFS.node_ops.setattr,
                    readlink: WXMEMFS.node_ops.readlink
                },
                stream: {}
            }
        };

        var node = FS.createNode(parent, name, mode);

        if (FS.isDir(node.mode)) {
            node.node_ops = WXMEMFS.ops_table.dir.node;
            node.stream_ops = WXMEMFS.ops_table.dir.stream;
            node.contents = {};
        } else if (FS.isFile(node.mode)) {
            node.node_ops = WXMEMFS.ops_table.file.node;
            node.stream_ops = WXMEMFS.ops_table.file.stream;
            node.usedBytes = 0;
            node.contents = null;
        } else if (FS.isLink(node.mode)) {
            node.node_ops = WXMEMFS.ops_table.link.node;
            node.stream_ops = WXMEMFS.ops_table.link.stream;
        }

        node.atime = node.mtime = node.ctime = Date.now();

        if (parent) {
            parent.contents[name] = node;
            parent.atime = parent.mtime = parent.ctime = node.atime;
        }

        return node;
    },

    // ============ Node Operations ============

    node_ops: {
        getattr: function (node) {
            var attr = {};
            attr.dev = FS.isChrdev(node.mode) ? node.id : 1;
            attr.ino = node.id;
            attr.mode = node.mode;
            attr.nlink = 1;
            attr.uid = 0;
            attr.gid = 0;
            attr.rdev = node.rdev;

            if (FS.isDir(node.mode)) {
                attr.size = 4096;
            } else if (FS.isFile(node.mode)) {
                attr.size = node.usedBytes;
            } else if (FS.isLink(node.mode)) {
                attr.size = node.link.length;
            } else {
                attr.size = 0;
            }

            attr.atime = new Date(node.atime);
            attr.mtime = new Date(node.mtime);
            attr.ctime = new Date(node.ctime);
            attr.blksize = 4096;
            attr.blocks = Math.ceil(attr.size / attr.blksize);

            return attr;
        },

        setattr: function (node, attr) {
            for (const key of ['mode', 'atime', 'mtime', 'ctime']) {
                if (attr[key] != null) {
                    node[key] = attr[key];
                }
            }
            if (attr.size !== undefined) {
                WXMEMFS.resizeFileStorage(node, attr.size);
            }
        },

        lookup: function (parent, name) {
            throw new FS.ErrnoError(44);
        },

        mknod: function (parent, name, mode, dev) {
            var node = WXMEMFS.createNode(parent, name, mode, dev);

            // 如果是文件或目录,同步到微信文件系统
            if (WXMEMFS.wxBasePath) {
                var wxPath = WXMEMFS.getWxPath(FS.getPath(node));

                try {
                    if (FS.isDir(mode)) {
                        wx.getFileSystemManager().mkdirSync(wxPath, true);
                        WXMEMFS.log('[WXMEMFS] mkdir:', wxPath);
                    } else if (FS.isFile(mode)) {
                        wx.getFileSystemManager().writeFileSync(wxPath, '', 'utf-8');
                        WXMEMFS.log('[WXMEMFS] mknod:', wxPath);

                        // ✅ 初始化为空内容,避免 loadNode 尝试加载
                        // node.contents 已经在 createNode 中设置为 null
                        // 这里确保它是空 Uint8Array
                        node.contents = new Uint8Array(0);
                        node.usedBytes = 0;
                        // 标记为已加载,避免 open 时重复加载空文件
                        WXMEMFS.lazyLoadedNodes.add(node);
                    }
                } catch (e) {
                    WXMEMFS.logError('[WXMEMFS] mknod failed:', wxPath, e.message);
                }
            }

            return node;
        },

        rename: function (old_node, new_dir, new_name) {
            var new_node;
            try {
                new_node = FS.lookupNode(new_dir, new_name);
            } catch (e) { }

            if (new_node) {
                if (FS.isDir(old_node.mode)) {
                    for (var i in new_node.contents) {
                        throw new FS.ErrnoError(55);
                    }
                }
                FS.hashRemoveNode(new_node);
            }

            delete old_node.parent.contents[old_node.name];
            new_dir.contents[new_name] = old_node;
            old_node.name = new_name;
            old_node.parent = new_dir;
            new_dir.ctime = new_dir.mtime = old_node.parent.ctime = old_node.parent.mtime = Date.now();

            // 同步到微信文件系统
            if (WXMEMFS.wxBasePath) {
                var oldWxPath = WXMEMFS.getWxPath(FS.getPath(old_node.parent) + '/' + old_node.name);
                var newWxPath = WXMEMFS.getWxPath(FS.getPath(new_dir) + '/' + new_name);

                try {
                    wx.getFileSystemManager().renameSync(oldWxPath, newWxPath);
                    WXMEMFS.log('[WXMEMFS] rename:', oldWxPath, '->', newWxPath);
                } catch (e) {
                    WXMEMFS.logError('[WXMEMFS] rename failed:', e.message);
                }
            }
        },

        unlink: function (parent, name) {
            delete parent.contents[name];
            parent.ctime = parent.mtime = Date.now();

            // 同步到微信文件系统
            if (WXMEMFS.wxBasePath) {
                var wxPath = WXMEMFS.getWxPath(FS.getPath(parent) + '/' + name);

                try {
                    wx.getFileSystemManager().unlinkSync(wxPath);
                    WXMEMFS.log('[WXMEMFS] unlink:', wxPath);
                } catch (e) {
                    WXMEMFS.logError('[WXMEMFS] unlink failed:', e.message);
                }
            }
        },

        rmdir: function (parent, name) {
            var node = FS.lookupNode(parent, name);
            for (var i in node.contents) {
                throw new FS.ErrnoError(55);
            }
            delete parent.contents[name];
            parent.ctime = parent.mtime = Date.now();

            // 同步到微信文件系统
            if (WXMEMFS.wxBasePath) {
                var wxPath = WXMEMFS.getWxPath(FS.getPath(parent) + '/' + name);

                try {
                    wx.getFileSystemManager().rmdirSync(wxPath, false);
                    WXMEMFS.log('[WXMEMFS] rmdir:', wxPath);
                } catch (e) {
                    WXMEMFS.logError('[WXMEMFS] rmdir failed:', e.message);
                }
            }
        },

        readdir: function (node) {
            return ['.', '..', ...Object.keys(node.contents)];
        },

        symlink: function (parent, newname, oldpath) {
            var node = WXMEMFS.createNode(parent, newname, 511 | 40960, 0);
            node.link = oldpath;
            return node;
        },

        readlink: function (node) {
            if (!FS.isLink(node.mode)) {
                throw new FS.ErrnoError(28);
            }
            return node.link;
        }
    },

    // ============ Stream Operations ============

    stream_ops: {
        open: function (stream) {
            var node = stream.node;
            var wxPath = WXMEMFS.getWxPath(stream.path);

            WXMEMFS.log('[WXMEMFS] open:', stream.path, 'flags:', stream.flags);

            // 写模式 (O_TRUNC): 清空内容
            if (stream.flags & 512) {  // O_TRUNC
                WXMEMFS.log('[WXMEMFS] O_TRUNC: clearing contents');
                WXMEMFS.resizeFileStorage(node, 0);
                // 标记为已加载,避免后续尝试加载
                WXMEMFS.lazyLoadedNodes.add(node);
            } else {
                // 读模式: 尝试懒加载 (仅在非 TRUNC 时)
                var flags = stream.flags & 2097155;  // O_ACCMODE
                if (flags === 0 || flags === 2) {  // O_RDONLY or O_RDWR
                    WXMEMFS.loadNode(node, wxPath);
                }
            }

            // 分配 wxfd (我们不实际打开微信 fd,只是用于索引)
            var wxfd = WXMEMFS.fdCounter++;
            stream.wxfd = wxfd;

            WXMEMFS.openStreams[wxfd] = {
                node: node,
                wxPath: wxPath,
                flags: stream.flags,
                dirty: false
            };

            // 增加引用计数
            var refCount = WXMEMFS.incrementRefCount(node);

            WXMEMFS.log('[WXMEMFS] opened: wxfd', wxfd, 'path:', wxPath, 'refCount:', refCount);
        },

        close: function (stream) {
            if (!stream.wxfd || !WXMEMFS.openStreams[stream.wxfd]) {
                return;
            }

            var streamInfo = WXMEMFS.openStreams[stream.wxfd];
            var node = streamInfo.node;

            WXMEMFS.log('[WXMEMFS] close: wxfd', stream.wxfd, 'dirty:', streamInfo.dirty);

            // 如果有修改,持久化到微信文件系统
            if (streamInfo.dirty && WXMEMFS.wxBasePath) {
                try {
                    WXMEMFS.persistNode(node, streamInfo.wxPath);
                } catch (e) {
                    WXMEMFS.logError('[WXMEMFS] close persist failed:', e.message);
                }
            }

            // ✅ 检查是否是 .pck 文件,如果是则标记为常驻缓存
            if (stream.path && stream.path.toLowerCase().endsWith('.pck')) {
                WXMEMFS.pckCache.set(node, true);
                WXMEMFS.pckPathCache[stream.path] = node;
                WXMEMFS.log('[WXMEMFS] PCK file cached in memory:', stream.path);
            }

            // 减少引用计数
            var refCount = WXMEMFS.decrementRefCount(node);
            WXMEMFS.log('[WXMEMFS] close: refCount after decrement:', refCount);

            // 如果引用计数为 0,释放内存 (PCK文件会被 releaseNodeContents 跳过)
            if (refCount === 0) {
                WXMEMFS.releaseNodeContents(node);
            }

            // 释放 fd
            delete WXMEMFS.openStreams[stream.wxfd];
            delete stream.wxfd;
        },

        read: function (stream, buffer, offset, length, position) {
            var contents = stream.node.contents;

            if (position >= stream.node.usedBytes)
                return 0;

            var size = Math.min(stream.node.usedBytes - position, length);

            if (size > 8 && contents.subarray) {
                buffer.set(contents.subarray(position, position + size), offset);
            } else {
                for (var i = 0; i < size; i++) {
                    buffer[offset + i] = contents[position + i];
                }
            }

            return size;
        },

        write: function (stream, buffer, offset, length, position, canOwn) {
            if (!length) return 0;

            var node = stream.node;
            node.mtime = node.ctime = Date.now();

            if (buffer.subarray && (!node.contents || node.contents.subarray)) {
                if (canOwn) {
                    node.contents = buffer.subarray(offset, offset + length);
                    node.usedBytes = length;

                    // 标记为脏
                    if (stream.wxfd && WXMEMFS.openStreams[stream.wxfd]) {
                        WXMEMFS.openStreams[stream.wxfd].dirty = true;
                    }

                    return length;
                } else if (node.usedBytes === 0 && position === 0) {
                    node.contents = buffer.slice(offset, offset + length);
                    node.usedBytes = length;

                    // 标记为脏
                    if (stream.wxfd && WXMEMFS.openStreams[stream.wxfd]) {
                        WXMEMFS.openStreams[stream.wxfd].dirty = true;
                    }

                    return length;
                } else if (position + length <= node.usedBytes) {
                    node.contents.set(buffer.subarray(offset, offset + length), position);

                    // 标记为脏
                    if (stream.wxfd && WXMEMFS.openStreams[stream.wxfd]) {
                        WXMEMFS.openStreams[stream.wxfd].dirty = true;
                    }

                    return length;
                }
            }

            WXMEMFS.expandFileStorage(node, position + length);

            if (node.contents.subarray && buffer.subarray) {
                node.contents.set(buffer.subarray(offset, offset + length), position);
            } else {
                for (var i = 0; i < length; i++) {
                    node.contents[position + i] = buffer[offset + i];
                }
            }

            node.usedBytes = Math.max(node.usedBytes, position + length);

            // 标记为脏
            if (stream.wxfd && WXMEMFS.openStreams[stream.wxfd]) {
                WXMEMFS.openStreams[stream.wxfd].dirty = true;
            }

            return length;
        },

        llseek: function (stream, offset, whence) {
            var position = offset;

            if (whence === 1) {
                position += stream.position;
            } else if (whence === 2) {
                if (FS.isFile(stream.node.mode)) {
                    position += stream.node.usedBytes;
                }
            }

            if (position < 0) {
                throw new FS.ErrnoError(28);
            }

            return position;
        }
    }
};

// ============ GODOTSDK 全局 API ============
// 在全局对象上挂载 WXMEMFS 相关的工具函数

if (typeof GameGlobal !== 'undefined' && GameGlobal.GODOTSDK) {
    var GODOTSDK = GameGlobal.GODOTSDK;

    /**
     * 释放指定的 PCK 文件缓存
     * @param {string} godotPath - Godot 文件路径 (例如: "user://pack.pck")
     * @returns {boolean} - 是否成功释放
     */
    GODOTSDK.releasePck = function (godotPath) {
        try {
            // 标准化路径: user://xxx -> 实际FS路径 (需要通过 FS 查询完整路径)
            // 由于 pckPathCache 存储的是完整 FS 路径,我们需要查找匹配
            var normalizedPath = godotPath;

            // 如果是 user:// 格式,尝试在缓存中查找匹配的路径
            if (godotPath.startsWith('user://')) {
                var fileName = godotPath.substr(7); // 去掉 "user://"
                var found = false;

                // 在 pckPathCache 中查找包含该文件名的路径
                for (var cachedPath in WXMEMFS.pckPathCache) {
                    if (cachedPath.endsWith(fileName)) {
                        normalizedPath = cachedPath;
                        found = true;
                        break;
                    }
                }

                if (!found) {
                    WXMEMFS.logWarn('[WXMEMFS] releasePck: PCK not found:', godotPath);
                    return false;
                }
            }

            var node = WXMEMFS.pckPathCache[normalizedPath];
            if (!node) {
                WXMEMFS.logWarn('[WXMEMFS] releasePck: PCK not found:', godotPath);
                return false;
            }

            // 从缓存中移除
            WXMEMFS.pckCache.delete(node);
            delete WXMEMFS.pckPathCache[normalizedPath];

            // 释放内存 (如果引用计数为0)
            var refCount = WXMEMFS.getRefCount(node);
            if (refCount === 0 && node.contents) {
                WXMEMFS.log('[WXMEMFS] releasePck: Releasing PCK contents, size:', node.usedBytes);
                node.contents = null;
                node.usedBytes = 0;
                WXMEMFS.lazyLoadedNodes.delete(node);
            } else {
                WXMEMFS.log('[WXMEMFS] releasePck: PCK still has', refCount, 'references, only removed from cache');
            }

            return true;
        } catch (e) {
            WXMEMFS.logError('[WXMEMFS] releasePck error:', e.message);
            return false;
        }
    };

    /**
     * 将 Godot 文件路径转换为微信真实文件路径
     * @param {string} godotPath - Godot 文件路径 (例如: "user://save.dat" 或 "/user/save.dat")
     * @returns {string} - 微信文件路径 (例如: "wxfile://usr/save.dat")
     */
    GODOTSDK.getWxPath = function (godotPath) {
        try {
            // 标准化路径: user://xxx -> /user/xxx
            var normalizedPath = godotPath;
            if (godotPath.startsWith('user://')) {
                normalizedPath = '/user' + godotPath.substr(6);
            }

            return WXMEMFS.getWxPath(normalizedPath);
        } catch (e) {
            WXMEMFS.logError('[WXMEMFS] getWxPath error:', e.message);
            return '';
        }
    };

    /**
     * 将微信真实文件路径转换为 Godot 文件路径
     * @param {string} wxPath - 微信文件路径 (例如: "wxfile://usr/save.dat" 或绝对路径)
     * @returns {string} - Godot 文件路径 (例如: "user://save.dat")
     */
    GODOTSDK.getGodotPath = function (wxPath) {
        try {
            // 从微信路径提取相对路径
            var relativePath = wxPath;

            // 如果是 wxBasePath 开头,去掉前缀
            if (WXMEMFS.wxBasePath && wxPath.startsWith(WXMEMFS.wxBasePath)) {
                relativePath = wxPath.substr(WXMEMFS.wxBasePath.length);
            }

            // 转换为 user:// 格式
            if (relativePath.startsWith('/')) {
                return 'user:/' + relativePath;  // user://xxx
            } else {
                return 'user://' + relativePath;
            }
        } catch (e) {
            WXMEMFS.logError('[WXMEMFS] getGodotPath error:', e.message);
            return '';
        }
    };

    WXMEMFS.log('[WXMEMFS] GODOTSDK API registered: releasePck, getWxPath, getGodotPath');
} else {
    WXMEMFS.logWarn('[WXMEMFS] GameGlobal.GODOTSDK not available, skipping API registration');
}
