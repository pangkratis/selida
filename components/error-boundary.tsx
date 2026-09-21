import { BorderRadius, Colors, roundedFont, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { logError } from '@/services/errorLog';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

/**
 * Catches render/lifecycle errors in the subtree below it so a single bad
 * render can't white-screen the whole app, and reports them to `errorLogs`.
 *
 * Must be a class component — `componentDidCatch`/`getDerivedStateFromError`
 * have no hook equivalent. The fallback UI is split into a function component
 * so it can still use hooks for theming and translation.
 */

type Props = {
  children: React.ReactNode;
  /** Identifies which boundary fired, when more than one is mounted. */
  context?: string;
};

type State = {
  error: Error | null;
  /** Bumped on retry to force a fresh mount of the subtree. */
  resetKey: number;
};

function ErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const { t } = useTranslation();
  const accent = theme.error;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.iconCircle, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Ionicons name="alert-circle-outline" size={40} color={accent} />
      </View>

      <Text style={[styles.title, { color: theme.text, fontFamily: roundedFont('700') }]}>
        {t('errorBoundaryTitle', 'Something went wrong')}
      </Text>

      <Text style={[styles.body, { color: theme.secondary, fontFamily: roundedFont('400') }]}>
        {t('errorBoundaryBody', "Selida hit an unexpected problem. Your reading data is safe — try again.")}
      </Text>

      {/* Only surface the raw message in development; in a release build it's
          noise to the user and the detail is already in `errorLogs`. */}
      {__DEV__ && (
        <Text style={[styles.debug, { color: theme.secondary, fontFamily: roundedFont('400') }]}>
          {error.message}
        </Text>
      )}

      <TouchableOpacity
        onPress={onRetry}
        activeOpacity={0.85}
        style={[styles.button, { backgroundColor: accent }]}
      >
        <Text style={[styles.buttonLabel, { fontFamily: roundedFont('700') }]}>
          {t('errorBoundaryRetry', 'Try again')}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // The component stack says which subtree broke — far more useful for
    // triage than the JS stack alone, which usually bottoms out in React
    // internals. Appended to the stack since `errorLogs` has no column
    // dedicated to it.
    const stack = [error.stack, info.componentStack].filter(Boolean).join('\n\nComponent stack:');
    const enriched = Object.assign(new Error(error.message), { stack, name: error.name });

    void logError(enriched, this.props.context ?? 'ErrorBoundary', { fatal: true });
  }

  handleRetry = () => {
    this.setState((prev) => ({ error: null, resetKey: prev.resetKey + 1 }));
  };

  render() {
    if (this.state.error) {
      return <ErrorFallback error={this.state.error} onRetry={this.handleRetry} />;
    }
    return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: BorderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.xs,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    // Explicit lineHeight — large bold text renders a taller glyph box than
    // fontSize implies on iOS and creeps into whatever sits above it.
    lineHeight: 28,
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: 320,
  },
  debug: {
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 17,
    textAlign: 'center',
    opacity: 0.7,
    maxWidth: 320,
  },
  button: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 4,
    borderRadius: BorderRadius.pill,
    marginTop: Spacing.sm,
  },
  buttonLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
