# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Sizing: design on iPhone 16, scale everywhere else

Screens are designed at iPhone 16 size (393×852 pt). Wrap every literal size
(width/height, padding, margins, radii, fontSize/lineHeight, icon `size`) in
`sz()` from `src/theme/scale.ts`, and use `tabBarClearance()` for bottom padding
that clears the floating tab bar. Don't wrap values derived from
`useWindowDimensions()`, ratios, or 1px borders. Import `SafeAreaView` from
`react-native-safe-area-context`, never from `react-native`.
