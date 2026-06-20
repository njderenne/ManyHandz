import * as ImagePicker from 'expo-image-picker'

/**
 * Image picker — choose from the library or capture a photo. Returns a local URI (or null if
 * cancelled / denied / errored). Works on web (file input). Never throws.
 */
export async function pickImage(): Promise<string | null> {
  try {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      // iPhones store photos as HEIC, which most upload targets (rembg.com included) reject.
      // 'Compatible' makes iOS transcode to JPEG on the way out. iOS-only; no-op elsewhere.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    })
    return res.canceled ? null : (res.assets[0]?.uri ?? null)
  } catch {
    return null
  }
}

export async function takePhoto(): Promise<string | null> {
  try {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) return null
    const res = await ImagePicker.launchCameraAsync({
      quality: 0.7,
      // Same as pickImage: the iPhone camera captures HEIC, which the media route's allow-list
      // rejects (→ a real "upload failed"). 'Compatible' transcodes to JPEG on the way out.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    })
    return res.canceled ? null : (res.assets[0]?.uri ?? null)
  } catch {
    return null
  }
}
