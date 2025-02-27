// @flow
import 'scss/component/_swipeable-drawer.scss';

import { lazyImport } from 'util/lazyImport';
import { useIsMobile, useIsMobileLandscape } from 'effects/use-screensize';
import { Menu, MenuList, MenuButton, MenuItem } from '@reach/menu-button';
import FileTitleSection from 'component/fileTitleSection';
import LivestreamLink from 'component/livestreamLink';
import React from 'react';
import { PRIMARY_PLAYER_WRAPPER_CLASS } from 'constants/player';
import VideoClaimInitiator from 'component/videoClaimInitiator';
import LivestreamScheduledInfo from 'component/livestreamScheduledInfo';
import * as ICONS from 'constants/icons';
import * as DRAWERS from 'constants/drawer_types';
import SwipeableDrawer from 'component/swipeableDrawer';
import DrawerExpandButton from 'component/swipeableDrawerExpand';
import LivestreamMenu from 'component/livestreamMenu';
import Icon from 'component/common/icon';
import CreditAmount from 'component/common/credit-amount';
import usePersistedState from 'effects/use-persisted-state';
import { getTipValues } from 'util/livestream';

const ChatLayout = lazyImport(() => import('component/chat' /* webpackChunkName: "chat" */));

const VIEW_MODES = {
  CHAT: 'chat',
  SUPERCHAT: 'sc',
};

type Props = {
  uri: string,
  livestreamChatEnabled: boolean,
  // -- redux --
  activeStreamUri: boolean | string,
  claim: ?StreamClaim,
  chatDisabled: boolean,
  isCurrentClaimLive: boolean,
  showScheduledInfo: boolean,
  superChats: Array<Comment>,
  activeViewers?: number,
  videoTheaterMode: boolean,
};

export default function LivestreamLayout(props: Props) {
  const {
    uri,
    livestreamChatEnabled,
    // -- redux --
    activeStreamUri,
    claim,
    chatDisabled,
    isCurrentClaimLive,
    showScheduledInfo,
    superChats,
    activeViewers,
    videoTheaterMode,
  } = props;

  const isMobile = useIsMobile();
  const isLandscapeRotated = useIsMobileLandscape();

  const [hyperchatsHidden, setHyperchatsHidden] = React.useState(false);
  const [chatViewMode, setChatViewMode] = React.useState(VIEW_MODES.CHAT);
  const [isCompact, setIsCompact] = usePersistedState('isCompact', false);

  const liveStatusFetching = activeStreamUri === undefined;

  if (!claim || !claim.signing_channel) return null;

  const { name: channelName } = claim.signing_channel;

  return (
    <section className="card-stack file-page__video">
      <div className={PRIMARY_PLAYER_WRAPPER_CLASS}>
        <VideoClaimInitiator uri={claim.canonical_url}>
          {showScheduledInfo && <LivestreamScheduledInfo uri={claim.canonical_url} />}
        </VideoClaimInitiator>
      </div>
      <div className="file-page__secondary-content">
        <div className="file-page__media-actions">
          <div className="section card-stack">
            {!liveStatusFetching && !activeStreamUri && !showScheduledInfo && !isCurrentClaimLive ? (
              <div className="help--notice" style={{ marginTop: '20px' }}>
                {channelName
                  ? __("%channelName% isn't live right now, but the chat is! Check back later to watch the stream.", {
                      channelName,
                    })
                  : __("This channel isn't live right now, but the chat is! Check back later to watch the stream.")}
              </div>
            ) : (
              chatDisabled && (
                <div className="help--notice">
                  {channelName
                    ? __('%channel% has disabled chat for this stream. Enjoy the stream!', { channel: channelName })
                    : __('This channel has disabled chat for this stream. Enjoy the stream!')}
                </div>
              )
            )}

            <LivestreamLink title={__("Click here to access the stream that's currently active")} uri={uri} />

            {isMobile && !isLandscapeRotated && !videoTheaterMode && livestreamChatEnabled && (
              <React.Suspense fallback={null}>
                <SwipeableDrawer
                  // startOpen
                  type={DRAWERS.CHAT}
                  title={
                    <ChatModeSelector
                      superChats={superChats}
                      chatViewMode={chatViewMode}
                      setChatViewMode={(mode) => setChatViewMode(mode)}
                      activeViewers={activeViewers}
                    />
                  }
                  hasSubtitle={activeViewers}
                  actions={
                    <LivestreamMenu
                      uri={uri}
                      noHyperchats={!superChats || superChats.length === 0}
                      hyperchatsHidden={hyperchatsHidden}
                      toggleHyperchats={() => setHyperchatsHidden(!hyperchatsHidden)}
                      toggleIsCompact={() => setIsCompact(!isCompact)}
                      isCompact={isCompact}
                      isMobile
                    />
                  }
                >
                  <ChatLayout
                    uri={uri}
                    hideHeader
                    hyperchatsHidden={hyperchatsHidden}
                    customViewMode={chatViewMode}
                    setCustomViewMode={(mode) => setChatViewMode(mode)}
                  />
                </SwipeableDrawer>

                <DrawerExpandButton icon={ICONS.CHAT} label={__('Open Live Chat')} type={DRAWERS.CHAT} />
              </React.Suspense>
            )}

            <FileTitleSection uri={uri} />
          </div>
        </div>

        {(!isMobile || isLandscapeRotated) && videoTheaterMode && livestreamChatEnabled && (
          <React.Suspense fallback={null}>
            <ChatLayout
              uri={uri}
              hyperchatsHidden={hyperchatsHidden}
              customViewMode={chatViewMode}
              setCustomViewMode={(mode) => setChatViewMode(mode)}
            />
          </React.Suspense>
        )}
      </div>
    </section>
  );
}

const ChatModeSelector = (chatSelectorProps: any) => {
  const { superChats, chatViewMode, setChatViewMode, activeViewers } = chatSelectorProps;
  const { superChatsFiatAmount, superChatsLBCAmount } = getTipValues(superChats);

  const titleProps = { chatViewMode, activeViewers };

  if (!superChats) {
    return <ChatDrawerTitle {...titleProps} />;
  }

  return (
    <Menu>
      <MenuButton>
        <div className="swipeable-drawer__menu">
          <ChatDrawerTitle {...titleProps} />

          <Icon icon={ICONS.DOWN} />
        </div>
      </MenuButton>

      <MenuList className="menu__list--header">
        <MenuItem className="menu__link" onSelect={() => setChatViewMode(VIEW_MODES.CHAT)}>
          {__('Live Chat')}
        </MenuItem>

        <MenuItem className="menu__link" onSelect={() => setChatViewMode(VIEW_MODES.SUPERCHAT)}>
          <div className="recommended-content__toggles">
            <CreditAmount amount={superChatsLBCAmount || 0} size={8} /> /
            <CreditAmount amount={superChatsFiatAmount || 0} size={8} isFiat /> {__('Tipped')}
          </div>
        </MenuItem>
      </MenuList>
    </Menu>
  );
};

const ChatDrawerTitle = (titleProps: any) => {
  const { chatViewMode, activeViewers } = titleProps;

  return (
    <div className="swipeable-drawer__title-menu">
      <span className="swipeable-drawer__title">
        {chatViewMode === VIEW_MODES.CHAT ? __('Live Chat') : __('HyperChats')}
      </span>

      {activeViewers && (
        <span className="swipeable-drawer__subtitle">{__('%view_count% viewers', { view_count: activeViewers })}</span>
      )}
    </div>
  );
};
