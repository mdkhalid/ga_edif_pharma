import { ApiError } from '@medichain/api-client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card, Screen } from '../../components/ui/Screen';
import { requestContactVerification, verifyContact } from '../../lib/api/client';
import type { AuthStackParamList } from '../../navigation/types';
import { colors, spacing, typography } from '../../theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'Otp'>;

/**
 * Contact verification.
 *
 * Issues a code on arrival and accepts it. After success the account is `ACTIVE` but
 * no session exists, so the user is returned to sign-in — there is exactly one screen
 * in the app that establishes a session.
 *
 * `devCode` is shown only when the API runs outside production with
 * `AUTH_EXPOSE_OTP_IN_RESPONSE=true`, so the flow is testable without an email or SMS
 * transport.
 */
export function OtpScreen({ navigation, route }: Props) {
  const initialIdentifier = route.params?.identifier ?? '';
  const [identifier, setIdentifier] = useState(initialIdentifier);
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const requested = useRef(false);

  useEffect(() => {
    if (initialIdentifier !== '' && !requested.current) {
      requested.current = true;
      requestContactVerification(initialIdentifier)
        .then((result) => setDevCode(result.devCode ?? null))
        .catch(() => undefined);
    }
  }, [initialIdentifier]);

  async function handleSubmit(): Promise<void> {
    setError(null);

    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the six-digit code from your email or SMS.');
      return;
    }

    setSubmitting(true);

    try {
      await verifyContact(identifier.trim(), code.trim());
      navigation.navigate('Login');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen
      title="Verify your email"
      subtitle="Enter the six-digit code we sent you. It expires shortly and works once."
    >
      <Card>
        {devCode !== null ? (
          <Text style={styles.devNote}>
            Development only — no email/SMS transport is configured, so the code is {devCode}.
          </Text>
        ) : null}

        <Input
          label="Email or phone"
          value={identifier}
          onChangeText={setIdentifier}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <Input
          label="Six-digit code"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          maxLength={6}
          autoComplete="one-time-code"
        />

        {error !== null ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}

        <Button title="Verify" onPress={() => void handleSubmit()} loading={submitting} />
        <Button
          title="Send a new code"
          variant="secondary"
          onPress={() => {
            void requestContactVerification(identifier.trim())
              .then((result) => setDevCode(result.devCode ?? null))
              .catch(() => undefined);
          }}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  devNote: { ...typography.muted, color: colors.warning, marginBottom: spacing.sm },
  error: { ...typography.muted, color: colors.danger },
});
