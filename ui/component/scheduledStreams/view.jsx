// @flow

import React from 'react';
import Icon from 'component/common/icon';
import * as CS from 'constants/claim_search';
import moment from 'moment';
import * as ICONS from 'constants/icons';
import { useIsLargeScreen, useIsMobile } from 'effects/use-screensize';
import ClaimListDiscover from 'component/claimListDiscover';
import Button from 'component/button';
import { LIVESTREAM_UPCOMING_BUFFER } from 'constants/livestream';
import { SCHEDULED_LIVESTREAM_TAG } from 'constants/tags';
import * as SETTINGS from 'constants/settings';
import './style.scss';

type Props = {
  channelIds: Array<string>,
  tileLayout: boolean,
  liveUris: Array<string>,
  limitClaimsPerChannel?: number,
  onLoad: (number) => void,
  showHideSetting: boolean,
  // --- perform ---
  setClientSetting: (string, boolean | string | number, boolean) => void,
  doShowSnackBar: (string) => void,
};

const ScheduledStreams = (props: Props) => {
  const {
    channelIds,
    tileLayout,
    liveUris = [],
    limitClaimsPerChannel,
    setClientSetting,
    doShowSnackBar,
    onLoad,
    showHideSetting = true,
  } = props;

  const isMobileScreen = useIsMobile();
  const isLargeScreen = useIsLargeScreen();

  const [totalUpcomingLivestreams, setTotalUpcomingLivestreams] = React.useState(0);
  const [showAllUpcoming, setShowAllUpcoming] = React.useState(false);

  const showUpcomingLivestreams = totalUpcomingLivestreams > 0;
  const useSwipeLayout = totalUpcomingLivestreams > 1 && isMobileScreen;

  const upcomingMax = React.useMemo(() => {
    if (showAllUpcoming || useSwipeLayout) return 50;
    if (isLargeScreen) return 6;
    if (isMobileScreen) return 3;
    return 4;
  }, [showAllUpcoming, isMobileScreen, isLargeScreen, useSwipeLayout]);

  const loadedCallback = (total) => {
    setTotalUpcomingLivestreams(total);
    if (typeof onLoad === 'function') onLoad(total);
  };

  const hideScheduledStreams = () => {
    setClientSetting(SETTINGS.HIDE_SCHEDULED_LIVESTREAMS, true, true);
    doShowSnackBar(__('Scheduled streams hidden, you can re-enable them in settings.'));
  };

  const Header = () => {
    return (
      <div className="claim-grid__header">
        <div className="button__content">
          <span className="icon__wrapper">
            <Icon icon={ICONS.VIDEO} />
          </span>
          <span className="claim-grid__title">{__('Upcoming Livestreams')}</span>
          {showHideSetting && (
            <Button button="link" label={__('Hide')} onClick={hideScheduledStreams} className={'hide-livestreams'} />
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className={'mb-m mt-m md:mb-xl upcoming-livestreams'}
      style={{ display: showUpcomingLivestreams ? 'block' : 'none' }}
    >
      <ClaimListDiscover
        swipeLayout={useSwipeLayout}
        useSkeletonScreen={false}
        channelIds={channelIds}
        limitClaimsPerChannel={limitClaimsPerChannel}
        pageSize={50}
        streamType={'all'}
        hasNoSource
        orderBy={CS.ORDER_BY_NEW_ASC}
        tileLayout={tileLayout}
        tags={[SCHEDULED_LIVESTREAM_TAG]}
        claimType={[CS.CLAIM_STREAM]}
        releaseTime={`>${moment().subtract(LIVESTREAM_UPCOMING_BUFFER, 'minutes').startOf('minute').unix()}`}
        hideAdvancedFilter
        hideFilters
        infiniteScroll={false}
        showNoSourceClaims
        hideLayoutButton
        header={<Header />}
        maxClaimRender={upcomingMax}
        excludeUris={liveUris}
        loadedCallback={loadedCallback}
      />
      {totalUpcomingLivestreams > upcomingMax && !showAllUpcoming && !useSwipeLayout && (
        <div className="livestream-list--view-more">
          <Button
            label={__('Show more upcoming livestreams')}
            button="link"
            iconRight={ICONS.ARROW_RIGHT}
            className="claim-grid__title--secondary"
            onClick={() => {
              setShowAllUpcoming(true);
            }}
          />
        </div>
      )}
      {showAllUpcoming && (
        <div className="livestream-list--view-more">
          <Button
            label={__('Show less upcoming livestreams')}
            button="link"
            iconRight={ICONS.ARROW_RIGHT}
            className="claim-grid__title--secondary"
            onClick={() => {
              setShowAllUpcoming(false);
            }}
          />
        </div>
      )}
    </div>
  );
};

export default ScheduledStreams;
