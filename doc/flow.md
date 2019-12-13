graph TD
O[/login or /register]-->A
A{findKycById} -->|Existed| B{needRecheckExistingKyc}
A -->|New|C(createKyc)

B-->|No|D(generateSsoPayload)
D-->F(SSoComplete)

B-->|Yes|Upload[nextAction='upload']
C-->Upload

Upload.->|/upload| Update(updateKyc)
Update-->E(generateSsoPayload)
E-->G(SSoComplete)

S[/status]-->S1{findKycById}
S1-->|New|S2(status=notFound)
S1-->|Existed|S3(queryKycStatus)

//----------------------------------------------------------------//

sequenceDiagram
participant MA
participant BPServer
participant Merchant
participant VerifierA

MA ->> Merchant: register
Merchant -->> MA: need cert from VerifierA
MA ->> VerifierA: submit attributes data
VerifierA ->> BPServer: Create CertPromise(CP)
BPServer -->> VerifierA: CP
VerifierA -->> MA: CP
MA ->> Merchant: CP+ attributes data(D)

VerifierA -->> BPServer: (Cert) Issued for CP

opt Merchant
BPServer ->> Merchant: Webhook Event (CP)
Merchant ->> BPServer: Pull (CP)
BPServer -->> Merchant: (Cert)
end
