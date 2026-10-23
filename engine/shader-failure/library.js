// Failure-only diagnostic imports. No GL calls, private heap access, or batch parsing.
mergeInto(LibraryManager.library, {
  $WXSLIMShaderFailure__deps: ['$UTF8ToString'],
  $WXSLIMShaderFailure: {
    prefix: function (value, limit) {
      var bytes = 0, end = 0;
      for (var i = 0; i < value.length;) {
        var c = value.charCodeAt(i), count = c < 128 ? 1 : c < 2048 ? 2 : 3, step = 1;
        if (c >= 55296 && c <= 56319 && i + 1 < value.length) {
          var next = value.charCodeAt(i + 1);
          if (next >= 56320 && next <= 57343) { count = 4; step = 2; }
        }
        if (bytes + count > limit) break;
        bytes += count; i += step; end = i;
      }
      return { text: value.slice(0, end), retainedUtf8Bytes: bytes, jsLength: value.length, truncated: end !== value.length };
    },
    state: function () { return Module['__wxslimShaderFailureStateV1']; }
  },
  wxslim_shader_failure_begin__deps: ['$WXSLIMShaderFailure'],
  wxslim_shader_failure_begin: function (program, shader, expectedType, variant, specializationLo, specializationHi, sourcePtr, sourceBytes, context) {
    try {
      var root = typeof GameGlobal !== 'undefined' ? GameGlobal : typeof globalThis !== 'undefined' ? globalThis : {};
      if (root.__godotMinigameWXGLXEnabled !== true || WXSLIMShaderFailure.state()) return 0;
      // Claim before any diagnostic allocation/decoding: observer failure never retries.
      Module['__wxslimShaderFailureStateV1'] = { active: false, armed: false, claimed: true };
      var record = {
        version: 1, program: program, shader: shader, expectedType: expectedType,
        variant: variant, specializationLo: specializationLo >>> 0, specializationHi: specializationHi >>> 0,
        contextAtFailure: context,
        GODOT_ORIGINAL: { available: false, sourceBytes: sourceBytes },
        GLX_BATCH_RETURN: { available: false, reason: 'source import not observed' },
        PLATFORM_ACTUAL_COMPILE_INPUT: { available: false, reason: 'opaque platform boundary' }
      };
      var state = { record: record, armed: false, active: true, taken: false, armCount: 0,
        take: function () {
          var token = this.armed && this.active && !this.taken;
          this.armed = false;
          if (token) { this.taken = true; this.record.sourceImportCount = 1; }
          return token ? this : null;
        },
        capture: function (raw, converted) {
          if (!this.active) return;
          var result = { label: 'GLX_BATCH_RETURN', rawType: typeof raw, rawNull: raw === null, convertedType: typeof converted, available: typeof raw === 'string' && typeof converted === 'string' };
          if (typeof converted === 'string') {
            result.source = WXSLIMShaderFailure.prefix(converted, 16384);
            if (typeof raw !== 'string') result.reason = 'converted response is not certified shader text';
          } else result.reason = 'no primitive string';
          this.record.GLX_BATCH_RETURN = result;
        }
      };
      Module['__wxslimShaderFailureStateV1'] = state;
      if (sourcePtr && sourceBytes >= 0) {
        var bounded = Math.min(sourceBytes, 16384);
        try {
          var source = WXSLIMShaderFailure.prefix(UTF8ToString(sourcePtr, bounded), 16384);
          source.truncated = source.truncated || sourceBytes > bounded;
          record.GODOT_ORIGINAL = { label: 'GODOT_ORIGINAL', available: true, sourceBytes: sourceBytes, source: source };
        } catch (ignoredSource) { record.GODOT_ORIGINAL.reason = 'owned source decode unavailable'; }
      }
      return 1;
    } catch (ignored) { return 0; }
  },
  wxslim_shader_failure_arm_source__deps: ['$WXSLIMShaderFailure'],
  wxslim_shader_failure_arm_source: function () {
    try { var s = WXSLIMShaderFailure.state(); if (s && s.active) { s.armCount++; s.record.sourceArmCount = s.armCount; s.armed = s.armCount === 1 && !s.taken; if (s.armCount !== 1) { s.record.GLX_BATCH_RETURN.available = false; s.record.GLX_BATCH_RETURN.reason = 'unexpected source arm count'; } } } catch (ignored) {}
  },
  wxslim_shader_failure_observe__deps: ['$WXSLIMShaderFailure'],
  wxslim_shader_failure_observe: function (type, length, context) {
    try { var s = WXSLIMShaderFailure.state(); if (s && s.active) {
      s.armed = false; s.record.queryObservationCount = (s.record.queryObservationCount || 0) + 1;
      s.record.batchReturnedType = type; s.record.batchReturnedSourceLength = length; s.record.contextAfterQueries = context;
      s.record.publicContextChanged = context !== s.record.contextAtFailure;
      if (s.record.publicContextChanged || length < 0 || type < 0 || s.armCount !== 1 || s.record.queryObservationCount !== 1) {
        s.record.GLX_BATCH_RETURN.available = false;
        s.record.GLX_BATCH_RETURN.reason = s.record.publicContextChanged ? 'public context changed; source association inconclusive' : 'query result or count unavailable';
      }
    } } catch (ignored) {}
  },
  wxslim_shader_failure_error__deps: ['$WXSLIMShaderFailure'],
  wxslim_shader_failure_error: function (errorPtr, bytes, context) {
    try { var s = WXSLIMShaderFailure.state(); if (s && s.active) { s.record.contextAtError = context; s.record.errorBytes = bytes; s.record.error = errorPtr && bytes > 0 ? WXSLIMShaderFailure.prefix(UTF8ToString(errorPtr, Math.min(bytes, 4096)), 4096) : { available: false, reason: 'original error log unavailable' }; if (s.record.error.text !== undefined) s.record.error.truncated = s.record.error.truncated || bytes > 4096; } } catch (ignored) {}
  },
  wxslim_shader_failure_end__deps: ['$WXSLIMShaderFailure'],
  wxslim_shader_failure_end: function () {
    try {
      var s = WXSLIMShaderFailure.state(); if (!s || !s.active) return;
      s.active = false; s.armed = false;
      var r = s.record;
      // JSON escaping can expand control characters: bound the complete console payload too.
      var payload = JSON.stringify(r), limit = 16384;
      while (WXSLIMShaderFailure.prefix(payload, 40960).truncated && limit > 0) {
        limit = Math.floor(limit / 2); r.consolePrefixTruncated = true;
        [r.GODOT_ORIGINAL.source, r.GLX_BATCH_RETURN.source, r.error].forEach(function (entry) {
          if (!entry || typeof entry.text !== 'string') return;
          var prefix = WXSLIMShaderFailure.prefix(entry.text, limit);
          entry.text = prefix.text; entry.retainedUtf8Bytes = prefix.retainedUtf8Bytes; entry.truncated = true;
        });
        payload = JSON.stringify(r);
      }
      function freeze(value) { if (value && typeof value === 'object') { Object.keys(value).forEach(function (key) { freeze(value[key]); }); Object.freeze(value); } }
      freeze(r); Module['__wxslimShaderFailureV1'] = r;
      console.info('[WXSLIM_SHADER_FAILURE_V1]', payload);
    } catch (ignored) {}
  }
});
