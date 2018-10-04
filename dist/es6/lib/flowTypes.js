//      

/**
 * --------------------------------------------------------
 * KYC Records
 * @type {object}
 */
                           

/**
 *
 * String fields from Mobile App
 * @type {Object}
 */
                             
                 
               
 

/**
 *
 * Binary fields from Mobile App
 * @type {Object}
 */
                           
               
                 
                       
 

/**
 * --------------------------------------------------------
 * Currently KycRecord status: "notFound" | "waiting" | "inreview" | "approved"
 * @type {string}
 */
                                                                           

/**
 * --------------------------------------------------------
 * Status for invidual fields: "received" | "approved" | "rejected" | "missing";
 * @type {string}
 */
                                 
              
              
              
             

/**
 * --------------------------------------------------------
 * Kyc Profile 's syncing status: "syncing" | "complete"
 * @type {string}
 */
                                               

/**
 * --------------------------------------------------------
 * KYC Record 's Field Status
 * @type {object}
 */
                                 
               
                              
                 
 

/**
 * --------------------------------------------------------
 * RawData upload from Mobile App
 * @type {Object.<string, RawDataString | RawDataFile>}
 * @example
 * {
 *  // string fields
 *  "phone": { type: 'string', value:'09xxx'},
 *
 *  // buffer fields
 *  "selfie": { type: 'file', buffer: Buffer(..), originalname: 'fileOriginalName'}
 *
 *  // certificate fields with `[cer]` prefix
 *  "[cer]onfido": {type: 'string', value:'...'}
 *
 *  ....
 * }
 */
                                        
                                            
 
/**
 * --------------------------------------------------------
 * KYC Record Status
 * @type {object}
 */
                                        
                       
                   
                     
                                   
                                    
 

/**
 * --------------------------------------------------------
 * Blockpass Kyc Profile object
 * @type {object}
 */
                          
             
                          
                   
                        
 

/**
 * --------------------------------------------------------
 * Blockpass KycToken object
 * @type {object}
 */
                        
                       
                     
                       
 

/**
 * --------------------------------------------------------
 * Client Next action: "none" | "upload"
 * @type {string}
 */
                                              

/**
 * --------------------------------------------------------
 * Blockpass Mobile Response
 * @type {object}
 */
                                              
                             
                   
                       
                            
                           
 

/**
 * --------------------------------------------------------
 * Handler function to query Kyc record by Id
 * @callback
 * @param {string} kycId
 * @return {Promise<KycRecord>}
 */
                                                                      

/**
 * --------------------------------------------------------
 * Handler function to create new KycRecord
 * @callback
 * @param {Object} params
 * @param {KycProfile} params.kycProfile
 * @returns {Promise<KycRecord>}
 */
                                                                       
           
 

/**
 * --------------------------------------------------------
 * Handler function to update existing KycRecord
 * @callback
 * @param {Object} params
 * @param {KycProfile} params.kycProfile
 * @param {KycRecord} params.kycRecord
 * @param {KycToken} params.kycToken
 * @param {Object} params.userRawData
 * @returns {Promise<KycRecord>}
 */
                                 
                         
                       
                     
                     
                        

/**
 * --------------------------------------------------------
 * Handler function to summary status of KycRecord
 * @callback
 * @param {Object} params
 * @param {KycRecord} params.kycRecord
 * @returns {Promise<MobileAppKycRecordStatus>}
 */
                                      
                      
                                       

/**
 * --------------------------------------------------------
 * Handler function processing user resubmit request
 * @callback
 * @param {Object} params
 * @param {KycProfile} params.kycProfile
 * @param {KycRecord} params.kycRecord
 * @param {KycToken} params.kycToken
 * @param {Object} params.payload
 * @returns {Promise<BlockpassMobileResponsePayload>}
 */
                                     
                         
                       
                     
                                         
                                             

/**
 * --------------------------------------------------------
 * Handler function to generate SSo payload
 * @callback
 * @param {Object} params
 * @param {KycProfile} params.kycProfile
 * @param {KycRecord} params.kycRecord
 * @param {KycToken} params.kycToken
 * @param {Object} params.payload
 * @returns {Promise<BlockpassMobileResponsePayload>}
 */
                                          
                         
                       
                     
                 
                                             

/**
 * --------------------------------------------------------
 * Handler function to generate Redirect payload
 * @callback
 * @param {Object} params
 * @param {KycProfile} params.kycProfile
 * @param {KycRecord} params.kycRecord
 * @param {KycToken} params.kycToken
 * @param {Object} params.payload
 * @returns {Promise<any>} Query string values
 */
                                               
                         
                       
                     
                 
                  

/**
 * --------------------------------------------------------
 * @type {Object}
 */
                                 
                  
                   
                   
                           
                           
                  
                                  
                              
                              
                                        
                                           
                                                 
                                                                         
                                                
                                                
                 
                            
 
