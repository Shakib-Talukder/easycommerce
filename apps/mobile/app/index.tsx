import { StyleSheet, Text, View } from "react-native";

// Scaffold only. The storefront screens will share @repo/db types and a
// future @repo/ui-native package with the web app.
export default function Home() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>আপনার দোকান</Text>
      <Text style={styles.subtitle}>Mobile storefront coming soon.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 16 },
  title: { fontSize: 28, fontWeight: "700", color: "#16a34a" },
  subtitle: { fontSize: 16, color: "#525252" },
});
