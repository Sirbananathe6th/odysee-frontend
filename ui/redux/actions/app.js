// @if TARGET='app'
import { execSync } from 'child_process';
import isDev from 'electron-is-dev';
import { ipcRenderer, remote } from 'electron';
// @endif
import path from 'path';
import { MINIMUM_VERSION, IGNORE_MINIMUM_VERSION, URL } from 'config';
import * as ACTIONS from 'constants/action_types';
import * as MODALS from 'constants/modal_types';
import * as SETTINGS from 'constants/settings';
import * as DAEMON_SETTINGS from 'constants/daemon_settings';
import * as SHARED_PREFERENCES from 'constants/shared_preferences';
import Lbry from 'lbry';
import { doFetchChannelListMine, doCheckPendingClaims } from 'redux/actions/claims';
import { selectClaimForUri, selectClaimIsMineForUri } from 'redux/selectors/claims';
import { doFetchFileInfos } from 'redux/actions/file_info';
import { doClearSupport, doBalanceSubscribe } from 'redux/actions/wallet';
import { doClearPublish } from 'redux/actions/publish';
import { Lbryio } from 'lbryinc';
import { doToast, doError, doNotificationList } from 'redux/actions/notifications';
import pushNotifications from '$web/src/push-notifications';

import Native from 'native';
import {
  doFetchDaemonSettings,
  doSetAutoLaunch,
  doSetDaemonSetting,
  doFindFFmpeg,
  doGetDaemonStatus,
} from 'redux/actions/settings';
import {
  selectIsUpgradeSkipped,
  selectUpdateUrl,
  selectUpgradeDownloadItem,
  selectUpgradeDownloadPath,
  selectUpgradeFilename,
  selectAutoUpdateDeclined,
  selectRemoteVersion,
  selectUpgradeTimer,
  selectModal,
  selectAllowAnalytics,
  selectAppDrawerOpen,
} from 'redux/selectors/app';
import { selectDaemonSettings, selectClientSetting } from 'redux/selectors/settings';
import { selectUser, selectUserVerifiedEmail } from 'redux/selectors/user';
import { doSetPrefsReady, doPreferenceGet, doPopulateSharedUserState, syncInvalidated } from 'redux/actions/sync';
import { doAuthenticate } from 'redux/actions/user';
import { doMembershipMine } from 'redux/actions/memberships';
import { lbrySettings as config, version as appVersion } from 'package.json';
import analytics from 'analytics';
import { doSignOutCleanup } from 'util/saved-passwords';
import { LocalStorage, LS } from 'util/storage';
import { doNotificationSocketConnect } from 'redux/actions/websocket';
import { stringifyServerParam, shouldSetSetting } from 'util/sync-settings';

// @if TARGET='app'
const { autoUpdater } = remote.require('electron-updater');
const { download } = remote.require('electron-dl');
const Fs = remote.require('fs');
// @endif

const CHECK_UPGRADE_INTERVAL = 10 * 60 * 1000;

export function doOpenModal(id, modalProps = {}) {
  return {
    type: ACTIONS.SHOW_MODAL,
    data: {
      id,
      modalProps,
    },
  };
}

export function doHideModal() {
  return {
    type: ACTIONS.HIDE_MODAL,
  };
}

export function doUpdateDownloadProgress(percent) {
  return {
    type: ACTIONS.UPGRADE_DOWNLOAD_PROGRESSED,
    data: {
      percent,
    },
  };
}

export function doSkipUpgrade() {
  return {
    type: ACTIONS.SKIP_UPGRADE,
  };
}

export function doStartUpgrade() {
  return (dispatch, getState) => {
    const state = getState();
    const upgradeDownloadPath = selectUpgradeDownloadPath(state);

    ipcRenderer.send('upgrade', upgradeDownloadPath);
  };
}

export function doDownloadUpgrade() {
  return (dispatch, getState) => {
    // @if TARGET='app'
    const state = getState();
    // Make a new directory within temp directory so the filename is guaranteed to be available
    const dir = Fs.mkdtempSync(remote.app.getPath('temp') + path.sep);
    const upgradeFilename = selectUpgradeFilename(state);

    const options = {
      onProgress: (p) => dispatch(doUpdateDownloadProgress(Math.round(p * 100))),
      directory: dir,
    };
    download(remote.getCurrentWindow(), selectUpdateUrl(state), options).then((downloadItem) => {
      /**
       * TODO: get the download path directly from the download object. It should just be
       * downloadItem.getSavePath(), but the copy on the main process is being garbage collected
       * too soon.
       */

      dispatch({
        type: ACTIONS.UPGRADE_DOWNLOAD_COMPLETED,
        data: {
          downloadItem,
          path: path.join(dir, upgradeFilename),
        },
      });
    });

    dispatch({
      type: ACTIONS.UPGRADE_DOWNLOAD_STARTED,
    });
    dispatch(doHideModal());
    dispatch(doOpenModal(MODALS.DOWNLOADING));
    // @endif
  };
}

export function doDownloadUpgradeRequested() {
  // This means the user requested an upgrade by clicking the "upgrade" button in the navbar.
  // If on Mac and Windows, we do some new behavior for the auto-update system.
  // This will probably be reorganized once we get auto-update going on Linux and remove
  // the old logic.

  return (dispatch) => {
    if (['win32', 'darwin'].includes(process.platform) || !!process.env.APPIMAGE) {
      // electron-updater behavior
      dispatch(doOpenModal(MODALS.AUTO_UPDATE_DOWNLOADED));
    } else {
      // Old behavior for Linux
      dispatch(doDownloadUpgrade());
    }
  };
}

export function doClearUpgradeTimer() {
  return (dispatch, getState) => {
    const state = getState();

    if (selectUpgradeTimer(state)) {
      clearInterval(selectUpgradeTimer(state));
      dispatch({
        type: ACTIONS.CLEAR_UPGRADE_TIMER,
      });
    }
  };
}

export function doAutoUpdate() {
  return (dispatch) => {
    dispatch({
      type: ACTIONS.AUTO_UPDATE_DOWNLOADED,
    });

    dispatch(doOpenModal(MODALS.AUTO_UPDATE_DOWNLOADED));

    dispatch(doClearUpgradeTimer());
  };
}

export function doAutoUpdateDeclined() {
  return (dispatch) => {
    dispatch(doClearUpgradeTimer());

    dispatch({
      type: ACTIONS.AUTO_UPDATE_DECLINED,
    });
  };
}

export function doCancelUpgrade() {
  return (dispatch, getState) => {
    const state = getState();
    const upgradeDownloadItem = selectUpgradeDownloadItem(state);

    if (upgradeDownloadItem) {
      /*
       * Right now the remote reference to the download item gets garbage collected as soon as the
       * the download is over (maybe even earlier), so trying to cancel a finished download may
       * throw an error.
       */
      try {
        upgradeDownloadItem.cancel();
      } catch (err) {
        console.error(err); // eslint-disable-line no-console
      }
    }

    dispatch({ type: ACTIONS.UPGRADE_CANCELLED });
  };
}

export function doCheckUpgradeAvailable() {
  return (dispatch, getState) => {
    const state = getState();
    dispatch({
      type: ACTIONS.CHECK_UPGRADE_START,
    });

    if (['win32', 'darwin'].includes(process.platform) || !!process.env.APPIMAGE) {
      // On Windows, Mac, and AppImage, updates happen silently through
      // electron-updater.
      const autoUpdateDeclined = selectAutoUpdateDeclined(state);

      if (!autoUpdateDeclined && !isDev) {
        autoUpdater.checkForUpdates();
      }
      return;
    }

    const success = ({ remoteVersion, upgradeAvailable }) => {
      dispatch({
        type: ACTIONS.CHECK_UPGRADE_SUCCESS,
        data: {
          upgradeAvailable,
          remoteVersion,
        },
      });

      if (
        upgradeAvailable &&
        !selectModal(state) &&
        (!selectIsUpgradeSkipped(state) || remoteVersion !== selectRemoteVersion(state))
      ) {
        dispatch(doOpenModal(MODALS.UPGRADE));
      }
    };

    const fail = () => {
      dispatch({
        type: ACTIONS.CHECK_UPGRADE_FAIL,
      });
    };

    Native.getAppVersionInfo().then(success, fail);
  };
}

/*
  Initiate a timer that will check for an app upgrade every 10 minutes.
 */
export function doCheckUpgradeSubscribe() {
  return (dispatch) => {
    const checkUpgradeTimer = setInterval(() => dispatch(doCheckUpgradeAvailable()), CHECK_UPGRADE_INTERVAL);
    dispatch({
      type: ACTIONS.CHECK_UPGRADE_SUBSCRIBE,
      data: { checkUpgradeTimer },
    });
  };
}

export function doMinVersionCheck() {
  return (dispatch) => {
    fetch(`${URL}/$/minVersion/v1/get`)
      .then((response) => response.json())
      .then((json) => {
        if (json?.status === 'success' && json?.data && MINIMUM_VERSION) {
          const liveMinimumVersion = Number(json.data);
          if (liveMinimumVersion > MINIMUM_VERSION) {
            dispatch({ type: ACTIONS.RELOAD_REQUIRED });
          }
        }
      })
      .catch((err) => {
        console.error(err);
      });
  };
}

export function doMinVersionSubscribe() {
  return (dispatch) => {
    if (IGNORE_MINIMUM_VERSION === 'true') {
      return;
    }

    dispatch(doMinVersionCheck());
    const CHECK_UPGRADE_INTERVAL_MS = 60 * 60 * 1000;
    setInterval(() => dispatch(doMinVersionCheck()), CHECK_UPGRADE_INTERVAL_MS);
  };
}

export function doCheckDaemonVersion() {
  return (dispatch) => {
    // @if TARGET='app'
    Lbry.version().then(({ lbrynet_version: lbrynetVersion }) => {
      // Avoid the incompatible daemon modal if running in dev mode
      // Lets you  run a different daemon than the one specified in package.json
      if (config.lbrynetDaemonVersion === lbrynetVersion || process.env.NODE_ENV !== 'production') {
        return dispatch({
          type: ACTIONS.DAEMON_VERSION_MATCH,
        });
      }

      dispatch({
        type: ACTIONS.DAEMON_VERSION_MISMATCH,
      });
      if (process.env.NODE_ENV === 'production') {
        return dispatch(doOpenModal(MODALS.INCOMPATIBLE_DAEMON));
      }
    });
    // @endif
    // @if TARGET='web'
    dispatch({
      type: ACTIONS.DAEMON_VERSION_MATCH,
    });
    // @endif
  };
}

export function doNotifyEncryptWallet() {
  return (dispatch) => {
    dispatch(doOpenModal(MODALS.WALLET_ENCRYPT));
  };
}

export function doNotifyDecryptWallet() {
  return (dispatch) => {
    dispatch(doOpenModal(MODALS.WALLET_DECRYPT));
  };
}

export function doNotifyUnlockWallet() {
  return (dispatch) => {
    dispatch(doOpenModal(MODALS.WALLET_UNLOCK));
  };
}

export function doNotifyForgetPassword(props) {
  return (dispatch) => {
    dispatch(doOpenModal(MODALS.WALLET_PASSWORD_UNSAVE, props));
  };
}

export function doAlertError(errorList) {
  return (dispatch) => {
    dispatch(doError(errorList));
  };
}

export function doAlertWaitingForSync() {
  return (dispatch, getState) => {
    const state = getState();
    const authenticated = selectUserVerifiedEmail(state);

    dispatch(
      doToast({
        message:
          !authenticated && IS_WEB
            ? __('Sign in or create an account to change this setting.')
            : __('Please wait a bit, we are still getting your account ready.'),
        isError: false,
      })
    );
  };
}

export function doDaemonReady() {
  return (dispatch, getState) => {
    const state = getState();

    // TODO: call doFetchDaemonSettings, then get usage data, and call doAuthenticate once they are loaded into the store
    const shareUsageData = IS_WEB || LocalStorage.getItem(LS.SHARE_INTERNAL) === 'true';

    dispatch(
      doAuthenticate(
        appVersion,
        shareUsageData,
        (status) => {
          const trendingAlgorithm =
            status &&
            status.wallet &&
            status.wallet.connected_features &&
            status.wallet.connected_features.trending_algorithm;

          if (trendingAlgorithm) {
            analytics.event.trendingAlgorithm(trendingAlgorithm);
          }
        },
        undefined
      )
    );
    dispatch({ type: ACTIONS.DAEMON_READY });

    // @if TARGET='app'
    dispatch(doBalanceSubscribe());
    dispatch(doSetAutoLaunch());
    dispatch(doFindFFmpeg());
    dispatch(doGetDaemonStatus());
    dispatch(doFetchDaemonSettings());
    dispatch(doFetchFileInfos());
    if (!selectIsUpgradeSkipped(state)) {
      dispatch(doCheckUpgradeAvailable());
    }
    dispatch(doCheckUpgradeSubscribe());
    // @endif
  };
}

export function doClearCache() {
  return (dispatch) => {
    // Need to update this to work with new version of redux-persist
    // Leaving for now
    // const reducersToClear = whiteListedReducers.filter(reducerKey => reducerKey !== 'tags');
    // window.cacheStore.purge(reducersToClear);
    window.sessionStorage.clear();
    dispatch(doClearSupport());
    window.location.reload();
    return dispatch(doClearPublish());
  };
}

export function doQuit() {
  return () => {
    // @if TARGET='app'
    remote.app.quit();
    // @endif
  };
}

export function doQuitAnyDaemon() {
  return (dispatch) => {
    // @if TARGET='app'
    Lbry.stop()
      .catch(() => {
        try {
          if (process.platform === 'win32') {
            execSync('taskkill /im lbrynet.exe /t /f');
          } else {
            execSync('pkill lbrynet');
          }
        } catch (error) {
          dispatch(doAlertError(`Quitting daemon failed due to: ${error.message}`));
        }
      })
      .finally(() => {
        dispatch(doQuit());
      });
    // @endif
  };
}

export function doChangeVolume(volume) {
  return (dispatch) => {
    dispatch({
      type: ACTIONS.VOLUME_CHANGED,
      data: {
        volume,
      },
    });
  };
}

export function doChangeMute(muted) {
  return (dispatch) => {
    dispatch({
      type: ACTIONS.VOLUME_MUTED,
      data: {
        muted,
      },
    });
  };
}

export function doClickCommentButton() {
  return {
    type: ACTIONS.ADD_COMMENT,
  };
}

export function doToggleSearchExpanded() {
  return {
    type: ACTIONS.TOGGLE_SEARCH_EXPANDED,
  };
}

export function doAnalyticsViewForUri(uri) {
  return (dispatch, getState) => {
    const state = getState();
    const claim = selectClaimForUri(state, uri);
    const { txid, nout, claim_id: claimId } = claim;
    const claimIsMine = selectClaimIsMineForUri(state, uri);
    const outpoint = `${txid}:${nout}`;

    if (claimIsMine) {
      return Promise.resolve();
    }

    return analytics.apiLog.view(uri, outpoint, claimId);
  };
}

export function doAnalyticsBuffer(uri, bufferData) {
  return (dispatch, getState) => {
    const isLivestream = bufferData.isLivestream;
    const state = getState();
    const claim = selectClaimForUri(state, uri);
    const user = selectUser(state);
    const {
      value: { video, audio, source },
    } = claim;
    const timeAtBuffer = isLivestream ? 0 : parseInt(bufferData.currentTime * 1000);
    const bufferDuration = parseInt(bufferData.secondsToLoad * 1000);
    const fileDurationInSeconds = isLivestream ? 0 : (video && video.duration) || (audio && audio.duration);
    const fileSize = isLivestream ? 0 : source.size; // size in bytes
    const fileSizeInBits = isLivestream ? '0' : fileSize * 8;
    const bitRate = isLivestream ? bufferData.bitrateAsBitsPerSecond : parseInt(fileSizeInBits / fileDurationInSeconds);
    const userId = user && user.id.toString();
    // if there's a logged in user, send buffer event data to watchman
    if (userId) {
      analytics.video.videoBufferEvent(claim, {
        isLivestream,
        timeAtBuffer,
        bufferDuration,
        bitRate,
        userId,
        duration: fileDurationInSeconds,
        playerPoweredBy: bufferData.playerPoweredBy,
        readyState: bufferData.readyState,
      });
    }
  };
}

export function doAnaltyicsPurchaseEvent(fileInfo) {
  return (dispatch) => {
    let purchasePrice = fileInfo.purchase_receipt && fileInfo.purchase_receipt.amount;
    if (purchasePrice) {
      const purchaseInt = Number(Number(purchasePrice).toFixed(0));
      analytics.event.purchase(purchaseInt);
    }
  };
}

export function doSignIn() {
  return (dispatch, getState) => {
    const state = getState();
    const user = selectUser(state);

    if (pushNotifications.supported && user) {
      pushNotifications.reconnect(user.id);
      pushNotifications.validate(user.id);
    }

    dispatch(doNotificationSocketConnect(true));
    dispatch(doNotificationList(null, false));
    dispatch(doCheckPendingClaims());
    dispatch(doBalanceSubscribe());
    dispatch(doFetchChannelListMine());
    dispatch(doMembershipMine());
  };
}

function clearBeforeUnloadListeners() {
  const beforeUnloads = Object.values(window.beforeUnloadMap || {});
  beforeUnloads.forEach((x) => {
    window.removeEventListener('beforeunload', x.cb);
  });
}

function doSignOutAction() {
  return async (dispatch, getState) => {
    const state = getState();
    const user = selectUser(state);
    try {
      if (pushNotifications.supported && user) {
        await pushNotifications.disconnect(user.id);
      }
    } finally {
      Lbryio.call('user', 'signout')
        .then(doSignOutCleanup)
        .then(() => {
          // @if TARGET='web'
          return window.persistor.purge();
          // @endif
        })
        .catch((err) => {
          analytics.error(`\`doSignOut\`: ${err.message || err}`);
        })
        .finally(() => location.reload());
    }
  };
}

export function doSignOut() {
  return async (dispatch, getState) => {
    const pendingActions = Object.values(window.beforeUnloadMap || {});
    if (pendingActions.length > 0) {
      dispatch(
        doOpenModal(MODALS.SIGN_OUT, {
          pendingActions: pendingActions.map((x) => x.msg),
          onConfirm: () => {
            clearBeforeUnloadListeners();
            dispatch(doSignOutAction());
          },
        })
      );
    } else {
      dispatch(doSignOutAction());
    }
  };
}

export function doSetWelcomeVersion(version) {
  return {
    type: ACTIONS.SET_WELCOME_VERSION,
    data: version,
  };
}

export function doSetHasNavigated() {
  return {
    type: ACTIONS.SET_HAS_NAVIGATED,
    data: true,
  };
}

export function doToggle3PAnalytics(allowParam, doNotDispatch) {
  return (dispatch, getState) => {
    const state = getState();
    const allowState = selectAllowAnalytics(state);
    const allow = allowParam !== undefined && allowParam !== null ? allowParam : allowState;
    analytics.toggleThirdParty(allow);
    if (!doNotDispatch) {
      return dispatch({
        type: ACTIONS.SET_ALLOW_ANALYTICS,
        data: allow,
      });
    }
  };
}

export function doGetAndPopulatePreferences(syncId /* ?: number */) {
  const { SDK_SYNC_KEYS } = SHARED_PREFERENCES;

  return (dispatch, getState) => {
    const state = getState();
    const syncEnabled = selectClientSetting(state, SETTINGS.ENABLE_SYNC);
    const hasVerifiedEmail = selectUserVerifiedEmail(state);
    let preferenceKey;
    // TODO: the logic should match `runPreferences`, but since this function is
    // only hit as a successful sync callback, it doesn't matter for now.
    // @if TARGET='app'
    preferenceKey = syncEnabled && hasVerifiedEmail ? 'shared' : 'local';
    // @endif
    // @if TARGET='web'
    preferenceKey = 'shared';
    // @endif

    function successCb(savedPreferences) {
      const successState = getState();
      const daemonSettings = selectDaemonSettings(successState);
      if (savedPreferences !== null) {
        if (!syncInvalidated(getState, syncId)) {
          dispatch(doPopulateSharedUserState(savedPreferences));
        }

        // @if TARGET='app'
        const { settings } = savedPreferences.value;
        if (settings) {
          Object.entries(settings).forEach(([key, val]) => {
            if (SDK_SYNC_KEYS.includes(key)) {
              if (shouldSetSetting(key, val, daemonSettings[key])) {
                if (key === DAEMON_SETTINGS.LBRYUM_SERVERS) {
                  const servers = stringifyServerParam(val);
                  dispatch(doSetDaemonSetting(key, servers, true));
                } else {
                  dispatch(doSetDaemonSetting(key, val, true));
                }
              }
            }
          });
        }
        // @endif
      } else {
        dispatch(doSetPrefsReady());
      }
      return true;
    }

    function failCb(er) {
      dispatch(
        doToast({
          isError: true,
          message: __('Unable to load your saved preferences.'),
        })
      );

      dispatch({
        type: ACTIONS.SYNC_FATAL_ERROR,
        error: er,
      });

      return false;
    }

    return dispatch(doPreferenceGet(preferenceKey, successCb, failCb));
  };
}

export function doHandleSyncComplete(error, hasNewData, syncId) {
  return (dispatch, getState) => {
    if (!error) {
      if (hasNewData) {
        if (syncInvalidated(getState, syncId)) {
          return;
        }

        dispatch(doGetAndPopulatePreferences(syncId));
      }
    } else {
      // eslint-disable-next-line no-console
      console.error('Error in doHandleSyncComplete', error);
    }
  };
}

export function doToggleInterestedInYoutubeSync() {
  return {
    type: ACTIONS.TOGGLE_YOUTUBE_SYNC_INTEREST,
  };
}

export function doToggleSplashAnimation() {
  return {
    type: ACTIONS.TOGGLE_SPLASH_ANIMATION,
  };
}

export function doSetActiveChannel(claimId, override) {
  return (dispatch, getState) => {
    if (claimId || override) {
      return dispatch({
        type: ACTIONS.SET_ACTIVE_CHANNEL,
        data: {
          claimId,
        },
      });
    }
  };
}

export function doSetIncognito(incognitoEnabled) {
  return {
    type: ACTIONS.SET_INCOGNITO,
    data: {
      enabled: incognitoEnabled,
    },
  };
}

export function doSetAdBlockerFound(found) {
  return {
    type: ACTIONS.SET_AD_BLOCKER_FOUND,
    data: found,
  };
}

export function doSetGdprConsentList(rawList = '') {
  // https://community.cookiepro.com/s/article/UUID-66bcaaf1-c7ca-5f32-6760-c75a1337c226?language=en_US
  const list = rawList.split(',').filter(Boolean);

  return {
    type: ACTIONS.SET_GDPR_CONSENT_LIST,
    data: list,
  };
}

export function doToggleAppDrawer(type) {
  return (dispatch, getState) => {
    const state = getState();
    const openDrawer = selectAppDrawerOpen(state);
    const isOpen = openDrawer && openDrawer === type;

    if (isOpen) {
      dispatch({ type: ACTIONS.DRAWER_CLOSED });
    } else {
      dispatch({ type: ACTIONS.DRAWER_OPENED, data: type });
    }
  };
}

export const doSetMainPlayerDimension = (dimensions) => (dispatch) =>
  dispatch({ type: ACTIONS.SET_MAIN_PLAYER_DIMENSIONS, data: dimensions });

export const doSetVideoSourceLoaded = (uri) => (dispatch) =>
  dispatch({ type: ACTIONS.SET_VIDEO_SOURCE_LOADED, data: uri });
