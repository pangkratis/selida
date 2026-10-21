import { ThemedText } from '@/components/themed-text';
import { AccentPalette, Colors, mixHex, roundedFont } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Ionicons } from '@expo/vector-icons';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export type ConfirmOptions = {
  title: string;
  message?: string;
  icon?: IconName;
  confirmLabel: string;
  cancelLabel: string;
  // Red confirm button and icon, for actions that can't be undone.
  destructive?: boolean;
};

export type AlertOptions = {
  title: string;
  message?: string;
  icon?: IconName;
  okLabel: string;
};

type Request = {
  kind: 'confirm' | 'alert';
  title: string;
  message?: string;
  icon?: IconName;
  confirmLabel: string;
  cancelLabel?: string;
  destructive: boolean;
  resolve: (confirmed: boolean) => void;
};

type DialogApi = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  alert: (options: AlertOptions) => Promise<void>;
};

const DialogContext = createContext<DialogApi | null>(null);

export const useDialog = (): DialogApi => {
  const api = useContext(DialogContext);
  if (!api) throw new Error('useDialog must be used inside <DialogProvider>');
  return api;
};

// App-wide replacement for Alert.alert: one themed dialog at a time, further
// requests wait their turn. `await confirm(...)` resolves true only when the
// confirm button is pressed (backdrop, cancel and Android back all mean "no").
export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<Request[]>([]);

  const api = useMemo<DialogApi>(() => ({
    confirm: options => new Promise<boolean>(resolve => {
      setQueue(q => [...q, {
        kind: 'confirm',
        title: options.title,
        message: options.message,
        icon: options.icon,
        confirmLabel: options.confirmLabel,
        cancelLabel: options.cancelLabel,
        destructive: !!options.destructive,
        resolve,
      }]);
    }),
    alert: options => new Promise<void>(resolve => {
      setQueue(q => [...q, {
        kind: 'alert',
        title: options.title,
        message: options.message,
        icon: options.icon,
        confirmLabel: options.okLabel,
        destructive: false,
        resolve: () => resolve(),
      }]);
    }),
  }), []);

  const current = queue[0] ?? null;
  const finish = useCallback((confirmed: boolean) => {
    setQueue(q => q.slice(1));
    current?.resolve(confirmed);
  }, [current]);

  return (
    <DialogContext.Provider value={api}>
      {children}
      <DialogView request={current} onFinish={finish} />
    </DialogContext.Provider>
  );
}

function DialogView({ request, onFinish }: { request: Request | null; onFinish: (confirmed: boolean) => void }) {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const { width } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;
  const [closing, setClosing] = useState(false);
  // Keep the last request on screen while the closing animation plays.
  const shown = useRef<Request | null>(null);
  if (request) shown.current = request;
  const view = request ?? shown.current;

  useEffect(() => {
    if (!request) return;
    setClosing(false);
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [request, progress]);

  const close = (confirmed: boolean) => {
    if (closing) return;
    setClosing(true);
    Animated.timing(progress, { toValue: 0, duration: 140, easing: Easing.in(Easing.quad), useNativeDriver: true })
      .start(() => onFinish(confirmed));
  };

  if (!view) return null;

  const accent = view.destructive ? theme.error : AccentPalette[1];
  const iconTint = mixHex(theme.surface, accent, colorScheme === 'dark' ? 0.22 : 0.12);
  const cardWidth = Math.min(width - 48, 360);

  return (
    <Modal
      visible={!!request}
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={() => close(false)}
    >
      <Animated.View style={[styles.backdrop, { opacity: progress }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => view.kind === 'confirm' && close(false)}
          accessibilityLabel={view.cancelLabel}
        />
        <Animated.View
          accessibilityRole="alert"
          style={[
            styles.card,
            {
              width: cardWidth,
              backgroundColor: theme.surface,
              borderColor: theme.border,
              opacity: progress,
              transform: [
                { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
                { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
              ],
            },
          ]}
        >
          {view.icon && (
            <View style={[styles.iconCircle, { backgroundColor: iconTint }]}>
              <Ionicons name={view.icon} size={26} color={accent} />
            </View>
          )}
          <ThemedText style={[styles.title, { color: theme.text }]}>{view.title}</ThemedText>
          {!!view.message && (
            <ThemedText style={[styles.message, { color: theme.secondary }]}>{view.message}</ThemedText>
          )}

          <View style={styles.buttons}>
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.85}
              onPress={() => close(true)}
              style={[styles.button, { backgroundColor: accent }]}
            >
              <ThemedText style={[styles.buttonText, { color: '#fff' }]} numberOfLines={2}>
                {view.confirmLabel}
              </ThemedText>
            </TouchableOpacity>
            {view.kind === 'confirm' && (
              <TouchableOpacity
                accessibilityRole="button"
                activeOpacity={0.7}
                onPress={() => close(false)}
                style={[styles.button, { backgroundColor: theme.background }]}
              >
                <ThemedText style={[styles.buttonText, { color: theme.text }]} numberOfLines={2}>
                  {view.cancelLabel}
                </ThemedText>
              </TouchableOpacity>
            )}
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  card: {
    alignItems: 'center',
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 12,
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '800',
    fontFamily: roundedFont('800'),
    textAlign: 'center',
  },
  message: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  buttons: {
    alignSelf: 'stretch',
    gap: 10,
    marginTop: 24,
  },
  button: {
    minHeight: 50,
    borderRadius: 25,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    fontFamily: roundedFont('700'),
    textAlign: 'center',
  },
});
