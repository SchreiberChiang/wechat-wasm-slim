extends RefCounted

# Geometry only: no console, cloud, GPU/context access, mutation, or callbacks.
# wx APIs use screen-origin rects; screenTop is kept raw for GDScript normalization.
# Missing wx is a supported browser case and returns an explicit fallback result.
const CODE := """
(function () {
  var api = typeof wx !== 'undefined' ? wx : null;
  function browserFallback(source) {
    var browser = typeof window === 'object' ? window : {};
    return JSON.stringify({source:source, coordinateOrigin:'window', coordinateOriginEvidence:'browser-window', windowWidth:number(browser.innerWidth), windowHeight:number(browser.innerHeight)});
  }
  if (!api) return browserFallback('browser-no-wx');
  var info = null, source = '';
  try { if (typeof api.getWindowInfo === 'function') { info = api.getWindowInfo(); source = 'wx.getWindowInfo'; } } catch (_) {}
  if (!info) {
    try { if (typeof api.getSystemInfoSync === 'function') { info = api.getSystemInfoSync(); source = 'wx.getSystemInfoSync'; } } catch (_) {}
  }
  if (!info) return browserFallback('wx-geometry-unavailable');
  function number(value) { return typeof value === 'number' && isFinite(value) ? value : null; }
  function rect(value) {
    if (!value || typeof value !== 'object') return null;
    return {left:number(value.left), top:number(value.top), right:number(value.right), bottom:number(value.bottom), width:number(value.width), height:number(value.height)};
  }
  var menu = null;
  try { if (typeof api.getMenuButtonBoundingClientRect === 'function') menu = api.getMenuButtonBoundingClientRect(); } catch (_) {}
  return JSON.stringify({source:source, coordinateOrigin:'screen', coordinateOriginEvidence:source+' API contract; not runtime verified', windowWidth:number(info.windowWidth), windowHeight:number(info.windowHeight), screenWidth:number(info.screenWidth), screenHeight:number(info.screenHeight), screenTop:number(info.screenTop), deviceOrientation:typeof info.deviceOrientation==='string'?info.deviceOrientation:'unknown', safeArea:rect(info.safeArea), menu:rect(menu)});
})()
"""
