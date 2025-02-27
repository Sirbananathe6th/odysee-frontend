// @flow
import React from 'react';

// $FlowFixMe
import { Global } from '@emotion/react';

import { Form } from 'component/common/form';
import { useHistory } from 'react-router-dom';
import { formatLbryUrlForWeb } from 'util/url';
import Card from 'component/common/card';
import ConfirmationPage from './internal/confirmationPage';
import PreviewPage from './internal/previewPage';
import Spinner from 'component/spinner';
import classnames from 'classnames';

import { ModalContext } from 'contexts/modal';

type Props = {
  uri: string,
  doHideModal: () => void,
  membershipIndex: number,
  passedTierIndex?: number,
  shouldNavigate?: boolean,
  membersOnly?: boolean,
  // -- redux --
  activeChannelClaim: ChannelClaim,
  channelName: ?string,
  channelClaimId: ?string,
  creatorMemberships: ?CreatorMemberships,
  incognito: boolean,
  unlockableTierIds: Array<number>,
  cheapestMembership: ?CreatorMembership,
  isLivestream: ?boolean,
  purchasedChannelMembership: MembershipTier & CreatorMembership,
  membershipMine: any,
  doMembershipList: (params: MembershipListParams) => Promise<CreatorMemberships>,
  doMembershipBuy: (membershipParams: MembershipBuyParams) => Promise<Membership>,
  doToast: (params: { message: string }) => void,
};

const JoinMembershipCard = (props: Props) => {
  const {
    uri,
    doHideModal,
    membershipIndex = 0,
    passedTierIndex,
    shouldNavigate,
    membersOnly,
    // -- redux --
    activeChannelClaim,
    channelName,
    channelClaimId,
    creatorMemberships,
    incognito,
    unlockableTierIds,
    cheapestMembership,
    isLivestream,
    purchasedChannelMembership,
    membershipMine,
    doMembershipList,
    doMembershipBuy,
    doToast,
  } = props;

  const isUrlParamModal = React.useContext(ModalContext)?.isUrlParamModal;

  const isPurchasing = React.useRef(false);

  const { push } = useHistory();

  const skipToConfirmation = Number.isInteger(passedTierIndex);

  const cheapestPlanIndex = React.useMemo(() => {
    if (cheapestMembership) {
      return (
        creatorMemberships &&
        creatorMemberships.findIndex((membership) => membership.Membership.id === cheapestMembership.Membership.id)
      );
    }
  }, [cheapestMembership, creatorMemberships]);

  const [isOnConfirmationPage, setConfirmationPage] = React.useState(skipToConfirmation);
  const [selectedMembershipIndex, setMembershipIndex] = React.useState(
    passedTierIndex || cheapestPlanIndex || membershipIndex
  );
  const selectedTier = creatorMemberships && creatorMemberships[selectedMembershipIndex];

  function handleJoinMembership() {
    if (!selectedTier || isPurchasing.current) return;

    isPurchasing.current = true;

    const membershipBuyParams: MembershipBuyParams = {
      membership_id: selectedTier.Membership.id,
      price_id: selectedTier.NewPrices[0].Price.stripe_price_id,
    };

    if (activeChannelClaim && !incognito) {
      Object.assign(membershipBuyParams, {
        channel_id: activeChannelClaim.claim_id,
        channel_name: activeChannelClaim.name,
      });
    }

    doMembershipBuy(membershipBuyParams)
      .then(() => {
        isPurchasing.current = false;

        if (doHideModal) {
          doHideModal();
        } else {
          window.pendingMembership = true;
          setConfirmationPage(false);
        }

        doToast({
          message: __(
            "You are now a '%membership_tier_name%' member for %creator_channel_name%, enjoy the perks and special features!",
            {
              membership_tier_name: selectedTier.Membership.name,
              creator_channel_name: selectedTier.Membership.channel_name,
            }
          ),
        });

        const purchasingUnlockableContentTier = unlockableTierIds.includes(selectedTier.Membership.id);

        if (shouldNavigate && purchasingUnlockableContentTier) {
          push(formatLbryUrlForWeb(uri));
        }
      })
      .catch(() => {
        isPurchasing.current = false;
      });
  }

  React.useEffect(() => {
    if (channelClaimId && channelName && creatorMemberships === undefined) {
      doMembershipList({ channel_name: channelName, channel_id: channelClaimId });
    }
  }, [channelClaimId, channelName, creatorMemberships, doMembershipList]);

  const pageProps = React.useMemo(() => {
    return { uri, selectedTier, selectedMembershipIndex };
  }, [selectedMembershipIndex, selectedTier, uri]);

  React.useEffect(() => {
    if (isUrlParamModal && purchasedChannelMembership) {
      // -- close url param modal when already has membership --
      doHideModal();
    }
  }, [doHideModal, isUrlParamModal, membershipMine, purchasedChannelMembership]);

  if (
    isUrlParamModal &&
    (membershipMine === undefined || creatorMemberships === undefined || purchasedChannelMembership)
  ) {
    // -- hide modal until a pendingPurchase condition is found to show it --
    return <Global styles={{ '.ReactModalPortal': { display: 'none' } }} />;
  }

  if (window.pendingMembership || creatorMemberships === undefined) {
    return (
      <div className="main--empty">
        <Spinner />
      </div>
    );
  }

  return (
    <Form onSubmit={handleJoinMembership}>
      <Card
        className={classnames('card--join-membership', {
          'membership-tier1': selectedMembershipIndex === 0,
          'membership-tier2': selectedMembershipIndex === 1,
          'membership-tier3': selectedMembershipIndex === 2,
          'membership-tier4': selectedMembershipIndex === 3,
          'membership-tier5': selectedMembershipIndex === 4,
          'membership-tier6': selectedMembershipIndex === 5,
        })}
        body={
          <>
            {isOnConfirmationPage ? (
              <ConfirmationPage {...pageProps} onCancel={() => setConfirmationPage(false)} />
            ) : (
              <PreviewPage
                {...pageProps}
                handleSelect={() => setConfirmationPage(true)}
                setMembershipIndex={setMembershipIndex}
                unlockableTierIds={unlockableTierIds}
                membersOnly={membersOnly}
                isLivestream={isLivestream}
              />
            )}
          </>
        }
      />
    </Form>
  );
};

export default JoinMembershipCard;
