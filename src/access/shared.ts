export const verifyIdentityWithFallback = async (identities: any, writerIdentity: any): Promise<boolean> => {
  const fallback = identities?.verifyIdentityFallback

  try {
    const verified = await identities.verifyIdentity(writerIdentity)
    if (verified) return true
    if (typeof fallback === 'function') {
      return await fallback(writerIdentity)
    }
    return false
  } catch (error) {
    // Primary verify can throw (e.g. provider edge cases). Prefer fallback for relay robustness.
    if (typeof fallback === 'function') {
      return await fallback(writerIdentity)
    }
    throw error
  }
}
