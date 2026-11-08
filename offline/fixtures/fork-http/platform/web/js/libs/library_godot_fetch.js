const GodotFetch = {
    $GodotFetch__deps: ['$IDHandler', '$GodotRuntime'],
    $GodotFetch: {
        // Convert various data types to Uint8Array
        convertToUint8Array: function (data) {
            if (!data) {
                return new Uint8Array(0);
            }

            // Already ArrayBuffer or TypedArray
            if (data instanceof ArrayBuffer) {
                return new Uint8Array(data);
            }
            if (ArrayBuffer.isView(data)) {
                return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
            }

            // String - encode to UTF-8
            if (typeof data === 'string') {
                const encoder = new TextEncoder();
                return encoder.encode(data);
            }

            // Object - convert to JSON string then encode
            if (typeof data === 'object') {
                const jsonStr = JSON.stringify(data);
                const encoder = new TextEncoder();
                return encoder.encode(jsonStr);
            }

            // Fallback - convert to string
            const str = String(data);
            const encoder = new TextEncoder();
            return encoder.encode(str);
        },

        onheaders: function (id, response) {
            const obj = IDHandler.get(id);
            if (!obj) {
                return;
            }
            // Set status code (default to 0 if not present)
            obj.status = response.statusCode || 0;
            
            // If we already have a response object (e.g. from partial headers), merge or update
            if (obj.response) {
                if (response.header) {
                    obj.response.header = response.header;
                }
                // Update other fields if needed
            } else {
                obj.response = response;
            }
        },

        onchunk: function (id, data) {
            const obj = IDHandler.get(id);
            if (!obj) {
                return;
            }
            // data is ArrayBuffer
            if (data && data.byteLength > 0) {
                const uint8Data = new Uint8Array(data);
                obj.chunks.push(uint8Data);
                if (obj.bodySize === -1) obj.bodySize = 0;
                obj.bodySize += uint8Data.byteLength;
            }
        },

        ondone: function (id) {
            const obj = IDHandler.get(id);
            if (!obj) {
                return;
            }
            obj.done = true;
            obj.reading = false;
        },

        onerror: function (id, err) {
            GodotRuntime.error(err);
            const obj = IDHandler.get(id);
            if (!obj) {
                return;
            }
            obj.error = err;
        },

        create: function (method, url, headers, body) {
            const obj = {
                requestTask: null,
                response: null,
                error: null,
                done: false,
                reading: false,
                status: 0,
                chunks: [],
                bodySize: -1,
            };
            const id = IDHandler.add(obj);

            try {
                const requestTask = wx.request({
                    url: url,
                    method: method,
                    data: body,
                    header: headers,
                    responseType: 'arraybuffer',
                    enableChunked: true,
                    success: (res) => {
                        const obj = IDHandler.get(id);
                        if (obj) {
                            // Fallback: if onHeadersReceived didn't fire or didn't set response
                            if (!obj.response) {
                                GodotFetch.onheaders(id, res);
                            }
                            
                            // Fallback: if no chunks were received via onChunkReceived, check res.data
                            // This handles cases where enableChunked might be ignored or data is small
                            if (obj.chunks.length === 0 && res.data) {
                                GodotFetch.onchunk(id, res.data);
                            }
                        }
                        GodotFetch.ondone(id);
                    },
                    fail: (err) => {
                        GodotFetch.onerror(id, err);
                    }
                });

                obj.requestTask = requestTask;

                requestTask.onHeadersReceived((res) => {
                    GodotFetch.onheaders(id, res);
                });

                requestTask.onChunkReceived((res) => {
                    if (res.data) {
                        GodotFetch.onchunk(id, res.data);
                    }
                });

            } catch (e) {
                GodotFetch.onerror(id, { errMsg: 'Exception: ' + e.message, errno: -1 });
            }

            return id;
        },

        free: function (id) {
            const obj = IDHandler.get(id);
            if (obj && obj.requestTask) {
                obj.requestTask.abort();
            }
            IDHandler.remove(id);
        },

        read: function (id) {
            // wx.request doesn't support streaming, so we don't need to implement this
        },
    },

    godot_js_fetch_create__sig: 'iiiiiii',
    godot_js_fetch_create: function (p_method, p_url, p_headers, p_headers_size, p_body, p_body_size) {
        const method = GodotRuntime.parseString(p_method);
        const url = GodotRuntime.parseString(p_url);
        const headers = GodotRuntime.parseStringArray(p_headers, p_headers_size);
        const body = p_body_size ? GodotRuntime.heapSlice(HEAP8, p_body, p_body_size) : null;
        return GodotFetch.create(method, url, headers.reduce((acc, hv) => {
            const idx = hv.indexOf(':');
            if (idx > 0) {
                acc[hv.slice(0, idx).trim()] = hv.slice(idx + 1).trim();
            }
            return acc;
        }, {}), body);
    },

    godot_js_fetch_state_get__sig: 'ii',
    godot_js_fetch_state_get: function (p_id) {
        const obj = IDHandler.get(p_id);
        if (!obj) {
            return -1;
        }

        let state = -1;
        if (obj.error) {
            state = -1;
        } else if (!obj.response) {
            state = 0; // Request in progress
        } else if (obj.done && obj.chunks.length === 0) {
            state = 2; // Done
        } else {
            state = 1; // Reading
        }

        return state;
    },

    godot_js_fetch_http_status_get__sig: 'ii',
    godot_js_fetch_http_status_get: function (p_id) {
        const obj = IDHandler.get(p_id);
        if (!obj || !obj.response) {
            return 0;
        }
        return obj.status;
    },

    godot_js_fetch_read_headers__sig: 'iiii',
    godot_js_fetch_read_headers: function (p_id, p_parse_cb, p_ref) {
        const obj = IDHandler.get(p_id);
        if (!obj || !obj.response) {
            return 1;
        }

        // Check if header exists and is an object
        if (!obj.response.header || typeof obj.response.header !== 'object') {
            return 1;
        }

        try {
            const cb = GodotRuntime.get_func(p_parse_cb);
            const arr = Object.entries(obj.response.header).map(([h, v]) => `${h}:${v}`);

            const c_ptr = GodotRuntime.allocStringArray(arr);

            const result = cb(arr.length, c_ptr, p_ref);

            GodotRuntime.freeStringArray(c_ptr, arr.length);
            return 0;
        } catch (e) {
            return 1;
        }
    },

    godot_js_fetch_read_chunk__sig: 'iiii',
    godot_js_fetch_read_chunk: function (p_id, p_buf, p_buf_size) {
        const obj = IDHandler.get(p_id);
        if (!obj || !obj.response) {
            return 0;
        }
        let to_read = p_buf_size;
        let write_offset = 0;
        const chunks = obj.chunks;
        while (to_read && chunks.length) {
            const chunk = chunks[0];
            if (chunk.length > to_read) {
                GodotRuntime.heapCopy(HEAP8, chunk.slice(0, to_read), p_buf + write_offset);
                chunks[0] = chunk.slice(to_read);
                write_offset += to_read;
                to_read = 0;
            } else {
                GodotRuntime.heapCopy(HEAP8, chunk, p_buf + write_offset);
                to_read -= chunk.length;
                write_offset += chunk.length;
                chunks.shift();
            }
        }
        return p_buf_size - to_read;
    },

    godot_js_fetch_body_length_get__sig: 'ii',
    godot_js_fetch_body_length_get: function (p_id) {
        const obj = IDHandler.get(p_id);
        if (!obj || !obj.response) {
            return -1;
        }
        return obj.bodySize;
    },

    godot_js_fetch_is_chunked__sig: 'ii',
    godot_js_fetch_is_chunked: function (p_id) {
        return 1;
    },

    godot_js_fetch_free__sig: 'vi',
    godot_js_fetch_free: function (id) {
        GodotFetch.free(id);
    },
};

autoAddDeps(GodotFetch, '$GodotFetch');
mergeInto(LibraryManager.library, GodotFetch);
