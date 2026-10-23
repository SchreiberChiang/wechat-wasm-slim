// Additive observer for the existing TYPE query. Never inspect returned objects.
mergeInto(LibraryManager.library, {
  $WXSLIMShaderTypeReturn: {
    arm: function () {
      var s = Module['__wxslimShaderFailureStateV1'];
      if (!s || !s.active || !s.record) return;
      if (s.typeReturnState) {
        s.typeReturnState.record.armCount++;
        s.typeReturnState.armed = false;
        s.typeReturnState.record.validArmCount = false;
        return;
      }
      var r = { version: 1, claimed: true, armCount: 1, validArmCount: true,
        takeCount: 0, captureCount: 0, returnObserved: false };
      var t = { armed: true, record: r };
      s.typeReturnState = t;
      s.record.GLX_TYPE_RAW_RETURN = r;
      s.typeTake = function (ptr, byteLength) {
        if (!s.active || !t.armed) return null;
        t.armed = false;
        r.takeCount++;
        r.ptr = ptr;
        r.byteLength = byteLength;
        return t;
      };
      t.capture = function (raw) {
        if (!s.active || r.captureCount !== 0) return;
        r.captureCount++;
        r.rawType = typeof raw;
        r.rawNull = raw === null;
        r.returnObserved = true;
        // Number.isFinite does not coerce. Only finite primitive numbers enter JSON.
        if (typeof raw === 'number') {
          r.numericFinite = Number.isFinite(raw);
          if (r.numericFinite) r.numericValue = raw;
        }
      };
    }
  },
  wxslim_shader_failure_arm_type__deps: ['$WXSLIMShaderTypeReturn'],
  wxslim_shader_failure_arm_type: function () {
    try { WXSLIMShaderTypeReturn.arm(); } catch (ignored) {}
  }
});
