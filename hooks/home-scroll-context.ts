import React from 'react';

export type HomeScrollListener = () => void;

export interface HomeScrollContextValue {
  active: boolean;
  addScrollListener: (fn: HomeScrollListener) => () => void;
  claimHint: () => boolean;
}

export const HomeScrollContext = React.createContext<HomeScrollContextValue>({
  active: false,
  addScrollListener: () => () => {},
  claimHint: () => false,
});