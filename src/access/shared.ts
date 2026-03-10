const isUnsupportedVarsigHeaderError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false
  return /Unsupported varsig header/i.test(error.message)
}

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
    if (!isUnsupportedVarsigHeaderError(error) || typeof fallback !== 'function') {
      throw error
    }
    return await fallback(writerIdentity)
  }
}
