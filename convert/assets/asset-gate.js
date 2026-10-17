/* WXSLIM_ASSET_GATE_ADAPTER_BEGIN */
var wxslimAssetDiagnostic={schema:'wxslim-dependency-actions-v1',events:[],dropped:0};
Module.__WXSLIM_ASSET_DIAGNOSTIC__=wxslimAssetDiagnostic;
function wxslimRecordAssetAction(action,source,applied,reason){
 var event={id:'wasm-preloadAssets',action:action,source:source,applied:applied,reason:reason,count:runDependencies,ready:Module.__WXSLIM_CUSTOM_PACKAGE_READY__===true,added:Module.__WXSLIM_ASSET_DEPENDENCY_ADDED__===true,released:Module.__WXSLIM_ASSET_DEPENDENCY_RELEASED__===true};
 if(wxslimAssetDiagnostic.events.length<48)wxslimAssetDiagnostic.events.push(event);else wxslimAssetDiagnostic.dropped++;
 wxslimAssetDiagnostic.lastCount=runDependencies;
}
Module.__WXSLIM_RELEASE_ASSET_GATE__=function(source){
 source=source==='sdk-remove'?'sdk-remove':source==='converter'?'converter':'custom-data';
 var reason=Module.__WXSLIM_ASSET_DEPENDENCY_RELEASED__===true?'already-released':Module.__WXSLIM_ASSET_DEPENDENCY_ADDED__!==true?'not-added':Module.__WXSLIM_CUSTOM_PACKAGE_READY__!==true?'data-not-validated':null;
 if(reason){wxslimRecordAssetAction('remove',source,false,reason);return false;}
 Module.__WXSLIM_ASSET_DEPENDENCY_RELEASED__=true;
 removeRunDependency('wasm-preloadAssets');
 wxslimRecordAssetAction('remove',source,true,'validated-release');
 return true;
};
Module.__WXSLIM_ADD_ASSET_GATE__=function(source){
 source=source==='sdk-add'?'sdk-add':'converter';
 if(Module.__WXSLIM_ASSET_DEPENDENCY_ADDED__===true){wxslimRecordAssetAction('add',source,false,'already-added');return false;}
 Module.__WXSLIM_ASSET_DEPENDENCY_ADDED__=true;
 addRunDependency('wasm-preloadAssets');
 wxslimRecordAssetAction('add',source,true,'first-add');
 Module.__WXSLIM_RELEASE_ASSET_GATE__('converter');
 return true;
};
Module['addRunDependency']=function(id){if(id==='wasm-preloadAssets')return Module.__WXSLIM_ADD_ASSET_GATE__('sdk-add');return addRunDependency(id);};
Module['removeRunDependency']=function(id){if(id==='wasm-preloadAssets')return Module.__WXSLIM_RELEASE_ASSET_GATE__('sdk-remove');return removeRunDependency(id);};
/* WXSLIM_ASSET_GATE_ADAPTER_END */
