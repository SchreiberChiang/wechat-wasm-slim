/* WX15_ASSET_GATE_ADAPTER_BEGIN */
var wx15AssetDiagnostic={schema:'wx15-dependency-actions-v1',events:[],dropped:0};
Module.__WX15_ASSET_DIAGNOSTIC__=wx15AssetDiagnostic;
function wx15RecordAssetAction(action,source,applied,reason){
 var event={id:'wasm-preloadAssets',action:action,source:source,applied:applied,reason:reason,count:runDependencies,ready:Module.__WX15_CUSTOM_PACKAGE_READY__===true,added:Module.__WX15_ASSET_DEPENDENCY_ADDED__===true,released:Module.__WX15_ASSET_DEPENDENCY_RELEASED__===true};
 if(wx15AssetDiagnostic.events.length<48)wx15AssetDiagnostic.events.push(event);else wx15AssetDiagnostic.dropped++;
 wx15AssetDiagnostic.lastCount=runDependencies;
}
Module.__WX15_RELEASE_ASSET_GATE__=function(source){
 source=source==='sdk-remove'?'sdk-remove':source==='converter'?'converter':'custom-data';
 var reason=Module.__WX15_ASSET_DEPENDENCY_RELEASED__===true?'already-released':Module.__WX15_ASSET_DEPENDENCY_ADDED__!==true?'not-added':Module.__WX15_CUSTOM_PACKAGE_READY__!==true?'data-not-validated':null;
 if(reason){wx15RecordAssetAction('remove',source,false,reason);return false;}
 Module.__WX15_ASSET_DEPENDENCY_RELEASED__=true;
 removeRunDependency('wasm-preloadAssets');
 wx15RecordAssetAction('remove',source,true,'validated-release');
 return true;
};
Module.__WX15_ADD_ASSET_GATE__=function(source){
 source=source==='sdk-add'?'sdk-add':'converter';
 if(Module.__WX15_ASSET_DEPENDENCY_ADDED__===true){wx15RecordAssetAction('add',source,false,'already-added');return false;}
 Module.__WX15_ASSET_DEPENDENCY_ADDED__=true;
 addRunDependency('wasm-preloadAssets');
 wx15RecordAssetAction('add',source,true,'first-add');
 Module.__WX15_RELEASE_ASSET_GATE__('converter');
 return true;
};
Module['addRunDependency']=function(id){if(id==='wasm-preloadAssets')return Module.__WX15_ADD_ASSET_GATE__('sdk-add');return addRunDependency(id);};
Module['removeRunDependency']=function(id){if(id==='wasm-preloadAssets')return Module.__WX15_RELEASE_ASSET_GATE__('sdk-remove');return removeRunDependency(id);};
/* WX15_ASSET_GATE_ADAPTER_END */
