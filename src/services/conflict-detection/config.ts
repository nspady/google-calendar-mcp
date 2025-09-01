/**
 * Centralized configuration for conflict detection thresholds
 */

export const CONFLICT_DETECTION_CONFIG = {
  /**
   * Thresholds for duplicate event detection
   */
  DUPLICATE_THRESHOLDS: {
    /**
     * Events with similarity >= this value are flagged as potential duplicates
     * and shown as warnings during creation
     */
    WARNING: 0.7,
    
    /**
     * Events with similarity >= this value are considered exact duplicates
     * and block creation unless explicitly overridden with allowDuplicates flag
     */
    BLOCKING: 0.95
  },
  
  /**
   * Default similarity threshold for duplicate detection
   * Used when duplicateSimilarityThreshold is not specified in the request
   */
  DEFAULT_DUPLICATE_THRESHOLD: 0.7
} as const;

export type ConflictDetectionConfig = typeof CONFLICT_DETECTION_CONFIG;