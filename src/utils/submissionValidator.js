const MediaAsset = require('../models/MediaAsset');

async function validateDraftForSubmission(draft, declaration, consent, aiDisclosureConfirmed) {
  const details = [];

  // 1. Title
  if (!draft.title || !draft.title.trim()) {
    details.push({ field: 'title', code: 'REQUIRED', message: 'Recipe title is required.' });
  }

  // 2. Geography
  if (!draft.state || !draft.state.trim()) {
    details.push({ field: 'state', code: 'REQUIRED', message: 'State of origin is required.' });
  }
  if (!draft.district || !draft.district.trim()) {
    details.push({ field: 'district', code: 'REQUIRED', message: 'District of origin is required.' });
  }

  // 3. Ingredients
  if (!Array.isArray(draft.ingredientsList) || draft.ingredientsList.length === 0) {
    details.push({ field: 'ingredients', code: 'MINIMUM_REQUIRED', message: 'Add at least one ingredient.' });
  } else {
    const hasName = draft.ingredientsList.some(ing => ing.name && ing.name.trim());
    if (!hasName) {
      details.push({ field: 'ingredients', code: 'INVALID_INGREDIENT', message: 'At least one ingredient must have a valid name.' });
    }
  }

  // 4. Cooking steps
  if (!Array.isArray(draft.cookingStepsList) || draft.cookingStepsList.length === 0) {
    details.push({ field: 'steps', code: 'MINIMUM_REQUIRED', message: 'Add at least one preparation or cooking step.' });
  }

  // 5. Source / Heritage account
  const hasSource = (draft.heritageSource && draft.heritageSource.trim()) || (draft.whoTaughtYou && draft.whoTaughtYou.trim());
  if (!hasSource) {
    details.push({ field: 'source', code: 'REQUIRED', message: 'Documented source, source person, or heritage account is required.' });
  }

  // 6. Declarations
  if (!declaration || !declaration.informationIsAccurate || !declaration.permissionToSubmit || !declaration.termsAccepted) {
    details.push({ field: 'declaration', code: 'REQUIRED', message: 'All contributor declaration options must be accepted.' });
  }

  // 7. Consents
  if (!consent || !consent.publicationPermission || !consent.sourceAttributionPermission) {
    details.push({ field: 'consent', code: 'REQUIRED', message: 'Publication and source attribution permissions are required.' });
  }

  // 8. AI use disclosure
  if (aiDisclosureConfirmed === undefined || aiDisclosureConfirmed === null) {
    details.push({ field: 'aiDisclosure', code: 'REQUIRED', message: 'AI-use disclosure confirmation is required.' });
  }

  // 9. Local URIs and Ready Status check
  const checkLocalMedia = (uri) => typeof uri === 'string' && (uri.startsWith('file://') || uri.startsWith('ph://'));
  
  if (draft.coverImage && checkLocalMedia(draft.coverImage)) {
    details.push({ field: 'coverImage', code: 'LOCAL_URI_UNSUPPORTED', message: 'Local image URIs cannot be used for submission.' });
  }

  // Verify archive images lists
  if (Array.isArray(draft.archiveImages) && draft.archiveImages.length > 0) {
    for (const img of draft.archiveImages) {
      if (img.assetId) {
        const asset = await MediaAsset.findOne({ assetId: img.assetId });
        if (!asset || asset.uploadStatus !== 'ready') {
          details.push({
            field: 'images',
            code: 'MEDIA_NOT_READY',
            message: `Image "${img.fileName || 'asset'}" is not fully uploaded or verified.`
          });
        }
      } else if (checkLocalMedia(img.uri)) {
        details.push({
          field: 'images',
          code: 'LOCAL_URI_UNSUPPORTED',
          message: 'Local media assets must be uploaded to the cloud before submitting.'
        });
      }
    }
  }

  // Verify oral history recording
  if (draft.oralHistoryAudio) {
    if (draft.oralHistoryAudio.assetId) {
      const asset = await MediaAsset.findOne({ assetId: draft.oralHistoryAudio.assetId });
      if (!asset || asset.uploadStatus !== 'ready') {
        details.push({
          field: 'audio',
          code: 'MEDIA_NOT_READY',
          message: 'Oral history recording is not fully uploaded or verified.'
        });
      }
    } else if (checkLocalMedia(draft.oralHistoryAudio.uri)) {
      details.push({
        field: 'audio',
        code: 'LOCAL_URI_UNSUPPORTED',
        message: 'Oral history audio recording must be uploaded to the cloud before submitting.'
      });
    }
  }

  return {
    isValid: details.length === 0,
    details
  };
}

module.exports = { validateDraftForSubmission };
