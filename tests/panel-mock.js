/* Local browser fixture only; never included in the extension manifest. */
window.chrome={runtime:{sendMessage:async request=>{
  const routes={PLAYER_PANEL_GET_STATE:'GET_STATE',PLAYER_PANEL_UPDATE_SETTINGS:'UPDATE_SETTINGS',PLAYER_PANEL_SELECT_TRACK:'SELECT_TRACK',PLAYER_PANEL_REFRESH:'REFRESH_TRACKS',PLAYER_PANEL_RETRY:'RETRY',PLAYER_PANEL_CLOSE:'CLOSE_PLAYER_SETTINGS'};
  return parent.fixture.request({...request,type:routes[request.type]});
}}};
