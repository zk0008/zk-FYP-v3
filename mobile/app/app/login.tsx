import { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../hooks/useAuth";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";

// required so the auth browser tab can hand back the result on iOS/Android
WebBrowser.maybeCompleteAuthSession();

const MS_CLIENT_ID =
  process.env.EXPO_PUBLIC_MICROSOFT_CLIENT_ID ?? "03b66d41-d374-4fa9-afcb-0bb1850698d3";

const MS_DISCOVERY = {
  authorizationEndpoint:
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  tokenEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
};

export default function Login() {
  const { login, microsoftLogin } = useAuth();
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [msLoading, setMsLoading] = useState(false);

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: MS_CLIENT_ID,
      scopes: ["openid", "profile", "email"],
      redirectUri: AuthSession.makeRedirectUri({ scheme: "zkfyp" }),
      extraParams: { prompt: "select_account" },
    },
    MS_DISCOVERY
  );

  useEffect(() => {
    if (!response) return;
    if (response.type === "success") {
      const code = response.params.code;
      setMsLoading(true);
      setError("");
      (async () => {
        try {
          const tokenResponse = await AuthSession.exchangeCodeAsync(
            {
              clientId: MS_CLIENT_ID,
              code,
              redirectUri: AuthSession.makeRedirectUri({ scheme: "zkfyp" }),
              extraParams: { code_verifier: request?.codeVerifier ?? "" },
            },
            MS_DISCOVERY
          );
          await microsoftLogin(tokenResponse.idToken ?? "");
          router.replace("/groups");
        } catch (err: any) {
          setError(err.message ?? "Microsoft login failed. Please try again.");
        } finally {
          setMsLoading(false);
        }
      })();
    } else if (response.type === "error") {
      setError(response.error?.message ?? "Microsoft sign-in failed.");
    }
  }, [response, request]);

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setError("Please enter your username and password.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await login(username.trim(), password);
      router.replace("/groups");
    } catch (err: any) {
      setError(err.message ?? "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.outer}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.appName}>MS3015 Chat</Text>
        <Text style={styles.subtitle}>Sign in to your account</Text>

        <TextInput
          style={styles.input}
          placeholder="Username"
          placeholderTextColor="#9e9e9e"
          autoCapitalize="none"
          autoCorrect={false}
          value={username}
          onChangeText={setUsername}
          editable={!loading}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#9e9e9e"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          editable={!loading}
          onSubmitEditing={handleLogin}
          returnKeyType="go"
        />

        {error !== "" && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Login</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.msButton, msLoading && styles.msButtonDisabled]}
          onPress={() => promptAsync()}
          disabled={msLoading}
          activeOpacity={0.8}
        >
          {msLoading ? (
            <ActivityIndicator color="#1a1a1a" />
          ) : (
            <Text style={styles.msButtonText}>Sign in with Microsoft</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    backgroundColor: "#f0f4f8",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 32,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  appName: {
    fontSize: 26,
    fontWeight: "700",
    color: "#1a1a1a",
    marginBottom: 4,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: "#757575",
    textAlign: "center",
    marginBottom: 28,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 15,
    color: "#1a1a1a",
    backgroundColor: "#fafafa",
    marginBottom: 14,
  },
  error: {
    color: "#d32f2f",
    fontSize: 13,
    marginBottom: 12,
    textAlign: "center",
  },
  button: {
    height: 48,
    backgroundColor: "#1976d2",
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 4,
  },
  buttonDisabled: {
    backgroundColor: "#90bce8",
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  msButton: {
    height: 48,
    backgroundColor: "#ffffff",
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#1a1a1a",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 12,
  },
  msButtonDisabled: {
    borderColor: "#9e9e9e",
  },
  msButtonText: {
    color: "#1a1a1a",
    fontSize: 16,
    fontWeight: "600",
  },
});
