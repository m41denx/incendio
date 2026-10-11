import { type FC, useState } from "react";
import { Input, Select } from "@canonical/react-components";
import { useQueryClient } from "@tanstack/react-query";
import FormModal from "../../components/FormModal";
import { request } from "../../api/client";
import type { User } from "../../api/types";
import { PLATFORM_ROLE_OPTIONS, toRole } from "./roles";

const CreateUser: FC<{ onClose: () => void }> = ({ onClose }) => {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("");
  const submit = async () => {
    const body = { email, name, ...(password && { password }), ...(toRole(role) && { platformRole: toRole(role) }) };
    await request<User>("POST", "/api/v1/users", body);
    await qc.invalidateQueries({ queryKey: ["users"] });
  };
  return (
    <FormModal title="Create user" submitLabel="Create" onSubmit={submit} onClose={onClose} submitDisabled={!email || !name || (!!password && password.length < 12)}>
      <Input id="user-email" label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <Input id="user-name" label="Name" type="text" required value={name} onChange={(e) => setName(e.target.value)} />
      <Input
        id="user-password"
        label="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        help="Optional, at least 12 characters. Leave empty for users who sign in through your identity provider."
        error={password && password.length < 12 ? "At least 12 characters" : undefined}
      />
      <Select id="user-role" label="Platform role" options={PLATFORM_ROLE_OPTIONS} value={role} onChange={(e) => setRole(e.target.value)} help="Tenant access is given on each tenant's page." />
    </FormModal>
  );
};

export default CreateUser;
