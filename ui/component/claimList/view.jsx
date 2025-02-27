// @flow
import { MAIN_CLASS } from 'constants/classnames';
import type { Node } from 'react';
import React, { useEffect } from 'react';
import classnames from 'classnames';
import ClaimPreview from 'component/claimPreview';
import Spinner from 'component/spinner';
import { FormField } from 'component/common/form';
import usePersistedState from 'effects/use-persisted-state';
import useGetLastVisibleSlot from 'effects/use-get-last-visible-slot';
import debounce from 'util/debounce';
import ClaimPreviewTile from 'component/claimPreviewTile';
import Button from 'component/button';
import { useIsMobile } from 'effects/use-screensize';

const Draggable = React.lazy(() =>
  // $FlowFixMe
  import('react-beautiful-dnd' /* webpackChunkName: "dnd" */).then((module) => ({ default: module.Draggable }))
);

const DEBOUNCE_SCROLL_HANDLER_MS = 150;
const SORT_NEW = 'new';
const SORT_OLD = 'old';

type Props = {
  uris: Array<string>,
  prefixUris?: Array<string>,
  header: Node | boolean,
  headerAltControls: Node,
  loading: boolean,
  useLoadingSpinner?: boolean, // use built-in spinner when 'loading' is true. Else, roll your own at client-side.
  type: string,
  activeUri?: string,
  empty?: string,
  defaultSort?: boolean,
  onScrollBottom?: (any) => void,
  page?: number,
  pageSize?: number,
  // If using the default header, this is a unique ID needed to persist the state of the filter setting
  persistedStorageKey?: string,
  showHiddenByUser: boolean,
  showUnresolvedClaims?: boolean,
  renderActions?: (Claim) => ?Node,
  renderProperties?: (Claim) => ?Node,
  includeSupportAction?: boolean,
  injectedItem?: ListInjectedItem,
  timedOutMessage?: Node,
  tileLayout?: boolean,
  searchInLanguage: boolean,
  hideMenu?: boolean,
  hideJoin?: boolean,
  claimSearchByQuery: { [string]: Array<string> },
  claimsByUri: { [string]: any },
  collectionId?: string,
  fypId?: string,
  showNoSourceClaims?: boolean,
  onClick?: (e: any, claim?: ?Claim, index?: number) => void,
  noEmpty?: boolean,
  maxClaimRender?: number,
  loadedCallback?: (number) => void,
  swipeLayout: boolean,
  showEdit?: boolean,
  droppableProvided?: any,
  unavailableUris?: Array<string>,
  inWatchHistory?: boolean,
  smallThumbnail?: boolean,
  showIndexes?: boolean,
  playItemsOnClick?: boolean,
  disableClickNavigation?: boolean,
  setActiveListItemRef?: any,
  setListRef?: any,
  doDisablePlayerDrag?: (disable: boolean) => void,
  restoreScrollPos?: () => void,
  setHasActive?: (has: boolean) => void,
};

export default function ClaimList(props: Props) {
  const {
    activeUri,
    uris,
    prefixUris,
    headerAltControls,
    loading,
    useLoadingSpinner,
    persistedStorageKey,
    empty,
    defaultSort,
    type,
    header,
    onScrollBottom,
    pageSize,
    page,
    showHiddenByUser,
    showUnresolvedClaims,
    includeSupportAction,
    injectedItem,
    timedOutMessage,
    tileLayout = false,
    renderActions,
    renderProperties,
    searchInLanguage,
    hideMenu,
    hideJoin,
    collectionId,
    fypId,
    showNoSourceClaims,
    onClick,
    noEmpty,
    maxClaimRender,
    loadedCallback,
    swipeLayout = false,
    showEdit,
    droppableProvided,
    unavailableUris,
    inWatchHistory,
    smallThumbnail,
    showIndexes,
    playItemsOnClick,
    disableClickNavigation,
    setActiveListItemRef,
    setListRef,
    doDisablePlayerDrag,
    restoreScrollPos,
    setHasActive,
  } = props;

  const isMobile = useIsMobile();

  const [currentSort, setCurrentSort] = usePersistedState(persistedStorageKey, SORT_NEW);
  const uriBuffer = React.useRef([]);

  const currentActiveItem = React.useRef();
  // Resolve the index for injectedItem, if provided; else injectedIndex will be 'undefined'.
  const listRef = React.useRef();
  const findLastVisibleSlot = injectedItem && injectedItem.node && injectedItem.index === undefined;
  const lastVisibleIndex = useGetLastVisibleSlot(listRef, !findLastVisibleSlot);

  // Exclude prefix uris in these results variables. We don't want to show
  // anything if the search failed or timed out.
  const timedOut = uris === null;
  const urisLength = (uris && uris.length) || 0;

  const tileUris = React.useMemo(() => {
    const x = (prefixUris || []).concat(uris || []);
    if (prefixUris && prefixUris.length) {
      x.splice(prefixUris.length * -1, prefixUris.length);
    }
    return maxClaimRender ? x.slice(0, maxClaimRender) : x;
  }, [prefixUris, uris, maxClaimRender]);

  const totalLength = tileUris.length;

  const sortedUris = (urisLength > 0 && (currentSort === SORT_NEW ? tileUris : tileUris.slice().reverse())) || [];

  React.useEffect(() => {
    if (typeof loadedCallback === 'function') loadedCallback(totalLength);
  }, [totalLength]); // eslint-disable-line react-hooks/exhaustive-deps

  const noResultMsg = searchInLanguage
    ? __('No results. Contents may be hidden by the Language filter.')
    : __('No results');

  function handleSortChange() {
    setCurrentSort(currentSort === SORT_NEW ? SORT_OLD : SORT_NEW);
  }

  const handleClaimClicked = React.useCallback(
    (e, claim, index) => {
      if (onClick) {
        onClick(e, claim, index);
      }
    },
    [onClick]
  );

  const customShouldHide = React.useCallback((claim: StreamClaim) => {
    // Hack to hide spee.ch thumbnail publishes
    // If it meets these requirements, it was probably uploaded here:
    // https://github.com/lbryio/lbry-redux/blob/master/src/redux/actions/publish.js#L74-L79
    return claim.name.length === 24 && !claim.name.includes(' ') && claim.value.author === 'Spee.ch';
  }, []);

  useEffect(() => {
    const handleScroll = debounce((e) => {
      if (page && pageSize && onScrollBottom) {
        const mainEl = document.querySelector(`.${MAIN_CLASS}`);
        if (mainEl && !loading && urisLength >= pageSize) {
          const ROUGH_TILE_HEIGHT_PX = 200;
          const mainBoundingRect = mainEl.getBoundingClientRect();
          const contentWrapperAtBottomOfPage = mainBoundingRect.bottom - ROUGH_TILE_HEIGHT_PX <= window.innerHeight;
          if (contentWrapperAtBottomOfPage) {
            onScrollBottom();
          }
        }
      }
    }, DEBOUNCE_SCROLL_HANDLER_MS);

    if (onScrollBottom) {
      window.addEventListener('scroll', handleScroll);
      return () => window.removeEventListener('scroll', handleScroll);
    }
  }, [loading, onScrollBottom, urisLength, pageSize, page]);

  const getClaimPreview = (uri: string, index: number, draggableProvided?: any) => (
    <ClaimPreview
      uri={uri}
      key={uri}
      indexInContainer={index}
      type={type}
      active={activeUri && uri === activeUri}
      hideMenu={hideMenu}
      hideJoin={hideJoin}
      includeSupportAction={includeSupportAction}
      showUnresolvedClaim={showUnresolvedClaims}
      properties={renderProperties || (type !== 'small' ? undefined : false)}
      renderActions={renderActions}
      showUserBlocked={showHiddenByUser}
      showHiddenByUser={showHiddenByUser}
      collectionId={collectionId}
      showNoSourceClaims={showNoSourceClaims}
      customShouldHide={customShouldHide}
      onClick={handleClaimClicked}
      swipeLayout={swipeLayout}
      showEdit={showEdit}
      dragHandleProps={draggableProvided && draggableProvided.dragHandleProps}
      wrapperElement={draggableProvided ? 'div' : undefined}
      unavailableUris={unavailableUris}
      inWatchHistory={inWatchHistory}
      smallThumbnail={smallThumbnail}
      showIndexes={showIndexes}
      playItemsOnClick={playItemsOnClick}
      disableClickNavigation={disableClickNavigation}
      doDisablePlayerDrag={doDisablePlayerDrag}
    />
  );

  const getInjectedItem = (index) => {
    if (injectedItem && injectedItem.node) {
      if (typeof injectedItem.node === 'function') {
        return injectedItem.node(index, lastVisibleIndex, pageSize);
      } else {
        if (injectedItem.index === undefined || injectedItem.index === null) {
          return index === lastVisibleIndex ? injectedItem.node : null;
        } else {
          return index === injectedItem.index ? injectedItem.node : null;
        }
      }
    }

    return null;
  };

  React.useEffect(() => {
    if (setHasActive) {
      // used in case the active item is deleted
      setHasActive(sortedUris.some((uri) => activeUri && uri === activeUri));
    }
  }, [activeUri, setHasActive, sortedUris]);

  const listRefCb = React.useCallback(
    (node) => {
      if (node) {
        if (droppableProvided) droppableProvided.innerRef(node);
        if (setListRef) setListRef(node);
      }
    },
    [droppableProvided, setListRef]
  );

  const listItemCb = React.useCallback(
    ({ node, isActive, draggableProvidedRef }) => {
      if (node) {
        if (draggableProvidedRef) draggableProvidedRef(node);

        // currentActiveItem.current !== node prevents re-scrolling during the same render
        // so it should only auto scroll when the active item switches, the button to scroll is clicked
        // or the list itself changes (switch between floating player vs file page)
        if (
          isActive &&
          setActiveListItemRef &&
          currentActiveItem.current !== node.getAttribute('data-rbd-draggable-id')
        ) {
          setActiveListItemRef(node);
          currentActiveItem.current = node.getAttribute('data-rbd-draggable-id');
        }
      }
    },
    [setActiveListItemRef]
  );

  return tileLayout && !header ? (
    <>
      <section ref={listRef} className={classnames('claim-grid', { 'swipe-list': swipeLayout })}>
        {urisLength > 0 &&
          tileUris.map((uri, index) => {
            if (uri) {
              const inj = getInjectedItem(index);
              if (inj) {
                if (!uriBuffer.current.includes(index)) {
                  uriBuffer.current.push(index);
                }
              }
              return (
                <React.Fragment key={uri}>
                  {inj && inj}
                  {(index < tileUris.length - uriBuffer.current.length ||
                    (pageSize && index < pageSize - uriBuffer.current.length) ||
                    (pageSize && tileUris.length % pageSize !== 0)) && (
                    <ClaimPreviewTile
                      uri={uri}
                      showHiddenByUser={showHiddenByUser}
                      showUnresolvedClaims={showUnresolvedClaims}
                      properties={renderProperties}
                      collectionId={collectionId}
                      fypId={fypId}
                      showNoSourceClaims={showNoSourceClaims}
                      swipeLayout={swipeLayout}
                    />
                  )}
                </React.Fragment>
              );
            }
          })}
        {!timedOut && urisLength === 0 && !loading && !noEmpty && (
          <div className="empty main--empty">{empty || noResultMsg}</div>
        )}
        {timedOut && timedOutMessage && <div className="empty main--empty">{timedOutMessage}</div>}
      </section>
      {loading && useLoadingSpinner && (
        <div className="spinnerArea--centered">
          <Spinner type="small" />
        </div>
      )}
    </>
  ) : (
    <section className={classnames('claim-list', { 'claim-list--no-margin': showIndexes })}>
      {header !== false && (
        <React.Fragment>
          {header && (
            <div className={classnames('claim-list__header', { 'section__title--small': type === 'small' })}>
              {header}
              {loading && <Spinner type="small" />}
              {(headerAltControls || defaultSort) && (
                <div className="claim-list__alt-controls">
                  {headerAltControls}
                  {defaultSort && (
                    <FormField
                      className="claim-list__dropdown"
                      type="select"
                      name="file_sort"
                      value={currentSort}
                      onChange={handleSortChange}
                    >
                      <option value={SORT_NEW}>{__('Newest First')}</option>
                      <option value={SORT_OLD}>{__('Oldest First')}</option>
                    </FormField>
                  )}
                </div>
              )}
            </div>
          )}
        </React.Fragment>
      )}

      {/* the droppable element needs to be rendered even if empty otherwise logs error on console */}
      {(urisLength > 0 || droppableProvided) && (
        <ul
          className={classnames('ul--no-style', {
            card: !(tileLayout || swipeLayout || type === 'small'),
            'claim-list--card-body': tileLayout,
            'swipe-list': swipeLayout,
          })}
          {...(droppableProvided && droppableProvided.droppableProps)}
          ref={listRefCb}
        >
          {droppableProvided ? (
            <>
              {sortedUris.map((uri, index) => (
                <React.Suspense fallback={null} key={uri}>
                  <Draggable draggableId={uri} index={index}>
                    {(draggableProvided, draggableSnapshot) => {
                      // Restrict dragging to vertical axis
                      // https://github.com/atlassian/react-beautiful-dnd/issues/958#issuecomment-980548919
                      let transform = draggableProvided.draggableProps.style.transform;
                      if (draggableSnapshot.isDragging && transform) {
                        transform = transform.replace(/\(.+,/, '(0,');
                      }

                      // doDisablePlayerDrag is a function brought by videoRenderFloating if is floating
                      const isDraggingFromFloatingPlayer = draggableSnapshot.isDragging && doDisablePlayerDrag;
                      const isDraggingFromMobile = draggableSnapshot.isDragging && isMobile;
                      const topForDrawer = Number(
                        // $FlowFixMe
                        document.documentElement?.style?.getPropertyValue('--content-height') || 0
                      );
                      const playerInfo = isDraggingFromFloatingPlayer && document.querySelector('.content__info');
                      const playerElem = isDraggingFromFloatingPlayer && document.querySelector('.content__viewer');
                      const playerTransform = playerElem && playerElem.style.transform;
                      let playerTop =
                        playerTransform &&
                        Number(
                          playerTransform.substring(playerTransform.indexOf(', ') + 2, playerTransform.indexOf('px)'))
                        );

                      const style = {
                        ...draggableProvided.draggableProps.style,
                        transform,
                        top: isDraggingFromFloatingPlayer
                          ? draggableProvided.draggableProps.style.top - playerInfo?.offsetTop - Number(playerTop)
                          : isDraggingFromMobile
                          ? draggableProvided.draggableProps.style.top - topForDrawer
                          : draggableProvided.draggableProps.style.top,
                        left: isDraggingFromFloatingPlayer ? undefined : draggableProvided.draggableProps.style.left,
                        right: isDraggingFromFloatingPlayer ? undefined : draggableProvided.draggableProps.style.right,
                      };
                      const isActive = activeUri && uri === activeUri;

                      return (
                        <li
                          ref={(node) =>
                            listItemCb({ node, isActive, draggableProvidedRef: draggableProvided.innerRef })
                          }
                          {...draggableProvided.draggableProps}
                          style={style}
                        >
                          {/* https://github.com/atlassian/react-beautiful-dnd/issues/1756 */}
                          <div style={{ display: 'none' }} {...draggableProvided.dragHandleProps} />
                          {getClaimPreview(uri, index, draggableProvided)}
                        </li>
                      );
                    }}
                  </Draggable>
                </React.Suspense>
              ))}
              {droppableProvided.placeholder}
            </>
          ) : (
            sortedUris.map((uri, index) => (
              <React.Fragment key={uri}>
                {getInjectedItem(index)}
                {getClaimPreview(uri, index)}
              </React.Fragment>
            ))
          )}
        </ul>
      )}

      {restoreScrollPos && (
        <Button
          button="secondary"
          className="claim-list__scroll-to-recent"
          label={__('Scroll to Playing')}
          onClick={restoreScrollPos}
        />
      )}

      {!timedOut && urisLength === 0 && !loading && !noEmpty && (
        <div className="empty empty--centered">{empty || noResultMsg}</div>
      )}
      {!loading && timedOut && timedOutMessage && <div className="empty empty--centered">{timedOutMessage}</div>}
      {loading && useLoadingSpinner && (
        <div className="spinnerArea--centered">
          <Spinner type="small" />
        </div>
      )}
    </section>
  );
}
