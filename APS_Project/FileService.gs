/**
 * ============================================================================
 * SANDVIORA AVIOSOLUTION - Google Drive Media & File Management Service
 * ============================================================================
 * File: FileService.gs
 * Architectural Role: Binary Media Asset Processing & Drive Integration
 * 
 * Description:
 * Manages employee profile picture uploads, certificates, and attachments.
 * Accepts Base64 data URLs from web form inputs, converts them to binary Blobs,
 * stores them in a dedicated Google Drive folder ('AeroHRMS_Pictures'), sets
 * view permissions, and returns persistent web view URLs for database storage.
 * ============================================================================
 */

var FileService = (function() {
  
  /**
   * Root folder name in Google Drive where employee photos and documents are stored.
   * @private
   */
  var FOLDER_NAME = 'AeroHRMS_Pictures';

  /**
   * Locates or lazily creates the master folder for HRMS pictures in Google Drive.
   * 
   * @private
   * @returns {GoogleAppsScript.Drive.Folder} The target Google Drive folder.
   */
  function getFolder() {
    var folders = DriveApp.getFoldersByName(FOLDER_NAME);
    if (folders.hasNext()) {
      return folders.next();
    }
    // Folder does not exist yet; create it at the root of the Drive
    return DriveApp.createFolder(FOLDER_NAME);
  }

  /**
   * Uploads a Base64-encoded image string to Google Drive and returns a viewable URL.
   * 
   * Workflow:
   * 1. Validates image data format (must begin with 'data:image/').
   * 2. Extracts MIME type (e.g. image/png, image/jpeg) and raw Base64 payload.
   * 3. Decodes Base64 into a raw binary byte array.
   * 4. Wraps bytes in a Google Drive Blob and saves it into the target folder.
   * 5. Sets file permissions so anyone with the link can view it in the app UI.
   * 
   * @param {string} base64Data - Full data URL (e.g. data:image/png;base64,iVBORw0KGgo...)
   * @param {string} filename - Target file name to assign in Google Drive.
   * @returns {string} Permanent Google Drive file URL.
   * @throws {Error} If base64Data is missing or does not represent a valid image.
   */
  function uploadImage(base64Data, filename) {
    if (!base64Data || !base64Data.startsWith('data:image/')) {
      throw new Error("Invalid image data provided. Expected a valid Base64 image data URL.");
    }

    // Step 1: Parse MIME type and raw base64 substring
    var splitData = base64Data.split(',');
    var mimeString = splitData[0].split(':')[1].split(';')[0];
    var rawBase64 = splitData[1];

    // Step 2: Decode into a binary Blob
    var decoded = Utilities.base64Decode(rawBase64);
    var blob = Utilities.newBlob(decoded, mimeString, filename);

    // Step 3: Save file in target Drive folder
    var folder = getFolder();
    var file = folder.createFile(blob);

    // Step 4: Configure sharing permissions for embedded browser display
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    // Step 5: Return public web link
    return file.getUrl();
  }

  return {
    /**
     * Public upload method called by Router.gs during record creation or updates.
     */
    uploadImage: uploadImage
  };

})();
