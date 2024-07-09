import * as React from 'react';
import { useEffect, useState, useRef, useCallback, useImperativeHandle, useReducer, forwardRef } from 'react';
import { NativeModules, requireNativeComponent, StyleSheet, UIManager, findNodeHandle, useWindowDimensions } from 'react-native';
import type { ViewProps, ViewStyle, StyleProp, NativeMethods, DimensionValue } from 'react-native';
import type { AdDisplayFailedInfo, AdInfo, AdLoadFailedInfo, AdRevenueInfo } from './types/AdInfo';
import type { AdNativeEvent } from './types/AdEvent';
import type { AdViewProps, AdViewHandler, NativeUIComponentAdViewOptions } from './types/AdViewProps';
import { addEventListener, removeEventListener } from './EventEmitter';

const { AppLovinMAX } = NativeModules;

const {
    BANNER_AD_FORMAT_LABEL,
    MREC_AD_FORMAT_LABEL,

    TOP_CENTER_POSITION,
    TOP_LEFT_POSITION,
    TOP_RIGHT_POSITION,
    CENTERED_POSITION,
    CENTER_LEFT_POSITION,
    CENTER_RIGHT_POSITION,
    BOTTOM_LEFT_POSITION,
    BOTTOM_CENTER_POSITION,
    BOTTOM_RIGHT_POSITION,

    ON_NATIVE_UI_COMPONENT_ADVIEW_AD_LOADED_EVENT,
    ON_NATIVE_UI_COMPONENT_ADVIEW_AD_LOAD_FAILED_EVENT,
} = AppLovinMAX.getConstants();

/**
 * Defines a format of an ad.
 */
export enum AdFormat {
    /**
     * Banner ad.
     */
    BANNER = BANNER_AD_FORMAT_LABEL,

    /**
     * MREC ad.
     */
    MREC = MREC_AD_FORMAT_LABEL,
}

/**
 * Defines a position of a banner or MREC ad.
 */
export enum AdViewPosition {
    TOP_CENTER = TOP_CENTER_POSITION,
    TOP_LEFT = TOP_LEFT_POSITION,
    TOP_RIGHT = TOP_RIGHT_POSITION,
    CENTERED = CENTERED_POSITION,
    CENTER_LEFT = CENTER_LEFT_POSITION,
    CENTER_RIGHT = CENTER_RIGHT_POSITION,
    BOTTOM_LEFT = BOTTOM_LEFT_POSITION,
    BOTTOM_CENTER = BOTTOM_CENTER_POSITION,
    BOTTOM_RIGHT = BOTTOM_RIGHT_POSITION,
}

type AdViewNativeEvents = {
    onAdLoadedEvent(event: AdNativeEvent<AdInfo>): void;
    onAdLoadFailedEvent(event: AdNativeEvent<AdLoadFailedInfo>): void;
    onAdDisplayFailedEvent(event: AdNativeEvent<AdDisplayFailedInfo>): void;
    onAdClickedEvent(event: AdNativeEvent<AdInfo>): void;
    onAdExpandedEvent(event: AdNativeEvent<AdInfo>): void;
    onAdCollapsedEvent(event: AdNativeEvent<AdInfo>): void;
    onAdRevenuePaidEvent(event: AdNativeEvent<AdRevenueInfo>): void;
};

const AdViewComponent = requireNativeComponent<AdViewProps & ViewProps & AdViewNativeEvents>('AppLovinMAXAdView');

type AdViewType = React.Component<AdViewProps> & NativeMethods;

type SizeKey = 'width' | 'height';
type SizeRecord = Partial<Record<SizeKey, DimensionValue>>;

const ADVIEW_SIZE = {
    banner: { width: 320, height: 50 },
    leader: { width: 728, height: 90 },
    mrec: { width: 300, height: 250 },
};

// Returns 'auto' for unspecified width / height
const getOutlineViewSize = (style: StyleProp<ViewStyle>) => {
    const viewStyle = StyleSheet.flatten(style || {});
    return [viewStyle?.width ?? 'auto', viewStyle?.height ?? 'auto'];
};

const sizeBannerDimensions = (sizeProps: SizeRecord, adaptiveBannerEnabled: boolean, screenWidth: number, bannerFormatSize: SizeRecord): Promise<SizeRecord> => {
    const sizeForBannerFormat = async () => {
        const width = sizeProps.width === 'auto' ? screenWidth : sizeProps.width;

        let height;
        if (sizeProps.height === 'auto') {
            if (adaptiveBannerEnabled) {
                height = await AppLovinMAX.getAdaptiveBannerHeightForWidth(screenWidth);
            } else {
                height = bannerFormatSize.height;
            }
        } else {
            height = sizeProps.height;
        }

        return Promise.resolve({ width: width, height: height });
    };

    return sizeForBannerFormat();
};

/**
 * The {@link AdView} component that you use building a banner or an MREC. Phones
 * sizes banners to 320x50 and MRECs to 300x250. Tablets sizes banners to 728x90 and MRECs to
 * 300x250. You may use the utility method {@link AppLovinMAX.isTablet()} to help with view sizing
 * adjustments. For adaptive banners, call {@link BannerAd.getAdaptiveHeightForWidth()} to get
 * the banner height, and then adjust your content accordingly.
 *
 * ### Example:
 * ```js
 * <AdView
 *   adUnitId={adUnitId}
 *   adFormat={AdFormat.BANNER}
 *   placement="my_placement"
 *   customData="my_customData"
 *   extraParameters={{"key1":"value1", "key2":"value2"}}
 *   localExtraParameters={{"key1":123", "key2":object}}
 *   adaptiveBannerEnabled={false}
 *   autoRefresh={false}
 *   style={styles.banner}
 *   onAdLoaded={(adInfo: AdInfo) => { ... }}
 * />
 * ```
 */
export const AdView = forwardRef<AdViewHandler, AdViewProps & ViewProps>(function AdView(
    {
        adUnitId,
        adFormat,
        placement,
        customData,
        adaptiveBannerEnabled = true,
        autoRefresh = true,
        loadOnMount = true,
        extraParameters,
        localExtraParameters,
        onAdLoaded,
        onAdLoadFailed,
        onAdDisplayFailed,
        onAdClicked,
        onAdExpanded,
        onAdCollapsed,
        onAdRevenuePaid,
        style,
        ...otherProps
    },
    ref
) {
    const { width: screenWidth } = useWindowDimensions();
    const adFormatSize = useRef<SizeRecord>({});
    const [, forceUpdate] = useReducer((x) => x + 1, 0);
    const adViewRef = useRef<AdViewType | null>(null);
    const [isInitialized, setIsInitialized] = useState<boolean>(false);
    const sizeProps = useRef<SizeRecord>({});
    const dimensions = useRef<SizeRecord>({});

    const loadAd = () => {
        if (adViewRef.current) {
            UIManager.dispatchViewManagerCommand(
                findNodeHandle(adViewRef.current),
                // @ts-ignore: Issue in RN ts defs
                UIManager.getViewManagerConfig('AppLovinMAXAdView').Commands.loadAd,
                undefined
            );
        }
    };

    useImperativeHandle(ref, () => ({ loadAd }), []);

    const saveElement = useCallback((element: AdViewType | null) => {
        if (element) {
            adViewRef.current = element;
        }
    }, []);

    useEffect(() => {
        if (adFormat === AdFormat.BANNER) {
            AppLovinMAX.isTablet().then((result: boolean) => {
                if (result) {
                    adFormatSize.current = { width: ADVIEW_SIZE.leader.width, height: ADVIEW_SIZE.leader.height };
                } else {
                    adFormatSize.current = { width: ADVIEW_SIZE.banner.width, height: ADVIEW_SIZE.banner.height };
                }
            });
        } else {
            adFormatSize.current = { width: ADVIEW_SIZE.mrec.width, height: ADVIEW_SIZE.mrec.height };
        }

        AppLovinMAX.isInitialized().then((result: boolean) => {
            setIsInitialized(result);
            if (!result) {
                console.warn('AdView is mounted before the initialization of the AppLovin MAX React Native module');
            }
        });
    }, [adFormat]); // Run once when mounted

    useEffect(() => {
        if (!isInitialized) return;

        const [width, height] = getOutlineViewSize(style);

        if (sizeProps.current.width === width && sizeProps.current.height === height) return;

        sizeProps.current = { width: width, height: height };

        if (adFormat === AdFormat.BANNER) {
            sizeBannerDimensions(sizeProps.current, adaptiveBannerEnabled, screenWidth, adFormatSize.current).then((adaptedSize: SizeRecord) => {
                if (dimensions.current.width !== adaptedSize.width || dimensions.current.height !== adaptedSize.height) {
                    dimensions.current = adaptedSize;
                    forceUpdate();
                }
            });
        } else {
            dimensions.current = {
                width: width === 'auto' ? adFormatSize.current.width : width,
                height: height === 'auto' ? adFormatSize.current.height : height,
            };
            forceUpdate();
        }
    }); // Run every render

    const onAdLoadedEvent = (event: AdNativeEvent<AdInfo>) => {
        if (onAdLoaded) onAdLoaded(event.nativeEvent);
    };

    const onAdLoadFailedEvent = (event: AdNativeEvent<AdLoadFailedInfo>) => {
        if (onAdLoadFailed) onAdLoadFailed(event.nativeEvent);
    };

    const onAdDisplayFailedEvent = (event: AdNativeEvent<AdDisplayFailedInfo>) => {
        if (onAdDisplayFailed) onAdDisplayFailed(event.nativeEvent);
    };

    const onAdClickedEvent = (event: AdNativeEvent<AdInfo>) => {
        if (onAdClicked) onAdClicked(event.nativeEvent);
    };

    const onAdExpandedEvent = (event: AdNativeEvent<AdInfo>) => {
        if (onAdExpanded) onAdExpanded(event.nativeEvent);
    };

    const onAdCollapsedEvent = (event: AdNativeEvent<AdInfo>) => {
        if (onAdCollapsed) onAdCollapsed(event.nativeEvent);
    };

    const onAdRevenuePaidEvent = (event: AdNativeEvent<AdRevenueInfo>) => {
        if (onAdRevenuePaid) onAdRevenuePaid(event.nativeEvent);
    };

    // Not initialized
    if (!isInitialized) {
        return null;
    } else {
        const isDimensionsSet = Object.keys(dimensions.current).length > 0;

        // Not sized yet
        if (!isDimensionsSet) {
            return null;
        }
    }

    return (
        <AdViewComponent
            ref={saveElement}
            adUnitId={adUnitId}
            adFormat={adFormat}
            placement={placement}
            customData={customData}
            adaptiveBannerEnabled={adaptiveBannerEnabled}
            autoRefresh={autoRefresh}
            loadOnMount={loadOnMount}
            extraParameters={extraParameters}
            localExtraParameters={localExtraParameters}
            onAdLoadedEvent={onAdLoadedEvent}
            onAdLoadFailedEvent={onAdLoadFailedEvent}
            onAdDisplayFailedEvent={onAdDisplayFailedEvent}
            onAdClickedEvent={onAdClickedEvent}
            onAdExpandedEvent={onAdExpandedEvent}
            onAdCollapsedEvent={onAdCollapsedEvent}
            onAdRevenuePaidEvent={onAdRevenuePaidEvent}
            style={Object.assign({}, style, dimensions.current)}
            {...otherProps}
        />
    );
});

/**
 * Preloads a native UI component for {@link AdView}. When you mount {@link AdView} with the Ad Unit
 * ID you preloaded, it will be constructed with the preloaded native UI component, allowing the ads
 * to be displayed quickly. When you unmount {@link AdView}, the preloaded native UI component won't
 * be destroyed. Instead, it will be reused for the next mount. You must manually destroy it when it
 * is no longer needed.
 *
 * You can preload only one native UI component for a single Ad Unit ID. If you mount two of
 * {@link AdView} with the same Ad Unit ID, the first {@link AdView} will be constructed with the
 * preloaded native UI component, but the second {@link AdView} will create its own native UI
 * component and destroy it when unmounting.
 *
 * @param adUnitId The Ad Unit ID to load ads for.
 * @param adFormat An enum value representing the ad format to load ads for. Should be either
 * {@link AdFormat.BANNER} or {@link AdFormat.MREC}.
 * @param options Optional props used to construct a native UI component.
 * @returns A promise that resolves when preload starts. The resolved object contains void.
 * @throws Throws an error if the request fails.
 */
export const preloadNativeUIComponentAdView = async (adUnitId: string, adFormat: AdFormat, options?: NativeUIComponentAdViewOptions): Promise<void> => {
    return AppLovinMAX.preloadNativeUIComponentAdView(adUnitId, adFormat, options?.placement, options?.customData, options?.extraParameters, options?.localExtraParameters);
};

/**
 * Destroys the native UI component.
 *
 * @param adUnitId The ad unit ID of the native UI component to destroy.
 * @returns A promise that resolves upon the destruction of the native UI component. The resolved
 * object contains void.
 * @throws Throws an error if the request fails.
 */
export const destroyNativeUIComponentAdView = async (adUnitId: string): Promise<void> => {
    return AppLovinMAX.destroyNativeUIComponentAdView(adUnitId);
};

/**
 * Adds the specified event listener to receive {@link AdInfo} when a native UI component loads a
 * new ad.
 *
 * @param listener Listener to be notified.
 */
export const addNativeUIComponentAdViewAdLoadedEventListener = (listener: (adInfo: AdInfo) => void) => {
    addEventListener(ON_NATIVE_UI_COMPONENT_ADVIEW_AD_LOADED_EVENT, (adInfo: AdInfo) => listener(adInfo));
};

/**
 * Removes the event listener to receive {@link AdInfo} when a native UI component loads a new ad.
 */
export const removeNativeUIComponentAdViewAdLoadedEventListener = () => {
    removeEventListener(ON_NATIVE_UI_COMPONENT_ADVIEW_AD_LOADED_EVENT);
};

/**
 * Adds the specified event listener to receive {@link AdLoadFailedInfo} when a native UI component
 * could not load a new ad.
 *
 * @param listener Listener to be notified.
 */
export const addNativeUIComponentAdViewAdLoadFailedEventListener = (listener: (errorInfo: AdLoadFailedInfo) => void) => {
    addEventListener(ON_NATIVE_UI_COMPONENT_ADVIEW_AD_LOAD_FAILED_EVENT, (errorInfo: AdLoadFailedInfo) => listener(errorInfo));
};

/**
 * Removes the event listener to receive {@link AdLoadFailedInfo} when a native UI component could
 * not load a new ad.
 */
export const removeNativeUIComponentAdViewAdLoadFailedEventListener = () => {
    removeEventListener(ON_NATIVE_UI_COMPONENT_ADVIEW_AD_LOAD_FAILED_EVENT);
};
