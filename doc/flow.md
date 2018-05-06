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