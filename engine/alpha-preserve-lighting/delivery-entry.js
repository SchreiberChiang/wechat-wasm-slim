import './weapp-adapter'
import './glx-config'
import './delivery-mode'
import './delivery-observer'
import './godot-loader'

// Preserve the tested native-audio policy. This sample does not exercise audio.
GameGlobal.__godotMinigameNativeAudioMinDurationSeconds = 9007199254740991;
GameGlobal.godotLoader = new GodotLoader(canvas, {
  textConfig: {firstStartText:'Loading',downloadingText:['Loading'],compilingText:'Compiling',initText:'Initializing',completeText:'Ready',textDuration:1500,style:{color:'#ffffff',fontSize:14}},
  barConfig:{style:{width:240,height:25,backgroundColor:'rgba(0,0,0,0.5)',foregroundColor:'#4CAF50',borderRadius:20,padding:2}},
  iconConfig:{visible:false,style:{width:74,height:30,bottom:20}},
  materialConfig:{backgroundImage:'',backgroundVideo:'',iconImage:''}
});
